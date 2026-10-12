import { HttpError } from "@/lib/api";
import { getRedis } from "@/lib/redis";

/**
 * Fixed-window rate limiting, backed by Redis when REDIS_URL is set and by
 * process memory otherwise.
 *
 * The store matters for correctness, not just scale: with N app instances and
 * in-memory counters, every instance allows the full quota, so the effective
 * limit is N times what it says. Single-instance installs keep the in-memory
 * path and need no Redis.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
const MAX_TRACKED_KEYS = 50_000;

function sweep(now: number) {
  if (windows.size < MAX_TRACKED_KEYS) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  if (windows.size >= MAX_TRACKED_KEYS) {
    let toDrop = Math.ceil(windows.size * 0.1);
    for (const key of windows.keys()) {
      windows.delete(key);
      if (--toDrop <= 0) break;
    }
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function hitMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const ok = existing.count <= limit;

  return {
    ok,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: ok ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

async function hitRedis(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return hitMemory(key, limit, windowMs);

  const namespaced = `rl:${key}`;

  try {
    // INCR then EXPIRE only on first hit, so the window starts with the first
    // request rather than sliding forward on every one.
    const pipeline = redis.multi();
    pipeline.incr(namespaced);
    pipeline.pttl(namespaced);
    const results = await pipeline.exec();

    const count = Number(results?.[0]?.[1] ?? 0);
    let ttl = Number(results?.[1]?.[1] ?? -1);

    if (ttl < 0) {
      await redis.pexpire(namespaced, windowMs);
      ttl = windowMs;
    }

    const ok = count <= limit;
    return {
      ok,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: ok ? 0 : Math.ceil(ttl / 1000),
    };
  } catch {
    // A Redis outage must not take authentication down. Degrade to the local
    // counter rather than failing open entirely or failing closed.
    return hitMemory(key, limit, windowMs);
  }
}

export function hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  return getRedis() ? hitRedis(key, limit, windowMs) : Promise.resolve(hitMemory(key, limit, windowMs));
}

/**
 * Header that server.ts stamps with the TCP peer address, after deleting any
 * inbound copy. Because we set it from the socket rather than believing the
 * client, it is trustworthy without a proxy in front.
 */
export const CLIENT_IP_HEADER = "x-thrum-client-ip";

export function clientAddress(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;

    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }

  const peer = req.headers.get(CLIENT_IP_HEADER)?.trim();
  if (peer) return peer;

  return "unknown";
}

/**
 * Limits come in two shapes, and conflating them is a self-inflicted outage.
 *
 * Per-ACCOUNT limits are the real defence against a targeted attack: guessing
 * one person's password. They can be tight, because one human signing in does
 * not need many attempts.
 *
 * Per-ADDRESS limits only exist to bound spray attacks across many accounts,
 * and they have to tolerate NAT. A 100- or 1000-person company typically
 * egresses from one or a handful of IPs, so an address limit sized for one
 * human (say 10 sign-ins per 10 minutes) locks out the entire office on Monday
 * morning: the first ten people in succeed and everyone else is refused. These
 * are therefore deliberately generous -- high enough that a whole organisation
 * behind one address is unaffected, low enough that a single host cannot run an
 * unbounded credential-stuffing run.
 *
 * Set TRUST_PROXY=1 behind a proxy that overwrites X-Forwarded-For and these
 * become genuinely per-client again.
 */
export const LIMITS = {
  /** Per target account. Tight: this is the targeted brute-force defence. */
  signInAccount: { limit: 10, windowMs: 10 * 60_000 },
  /** Per address. Generous: must not lock out a NATed organisation. */
  signInAddress: { limit: 600, windowMs: 10 * 60_000 },

  /** Per address. Onboarding 1000 people from one office must not stall. */
  register: { limit: 300, windowMs: 60 * 60_000 },

  /** Per address. Code entropy is the real control; this bounds cost. */
  redeemInvite: { limit: 300, windowMs: 10 * 60_000 },

  /** Per user. Real chat is bursty. */
  sendMessage: { limit: 60, windowMs: 60_000 },
  /** Per user. */
  upload: { limit: 40, windowMs: 10 * 60_000 },
  /** Per user. The most expensive read we expose. */
  search: { limit: 60, windowMs: 60_000 },
  /** Per user. */
  createResource: { limit: 40, windowMs: 60 * 60_000 },
  /** Per user. */
  createInvite: { limit: 40, windowMs: 60 * 60_000 },
  /** Per user. Password reset requests. */
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  /** Per address, for the unauthenticated reset endpoint. */
  passwordResetAddress: { limit: 100, windowMs: 60 * 60_000 },
} as const;

/** Applies a named limit, throwing 429 when exceeded. */
export async function enforce(
  name: keyof typeof LIMITS,
  identity: string,
): Promise<void> {
  const { limit, windowMs } = LIMITS[name];
  const result = await hit(`${name}:${identity}`, limit, windowMs);
  if (result.ok) return;

  throw new HttpError(
    429,
    `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
  );
}
