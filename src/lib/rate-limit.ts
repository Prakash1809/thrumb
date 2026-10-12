import { HttpError } from "@/lib/api";

/**
 * Fixed-window rate limiter held in process memory.
 *
 * Scope and limits, stated plainly: this protects a single-instance deployment.
 * Counters are per process, so N app instances behind a load balancer each allow
 * the full quota, and a restart clears every window. That is an acceptable
 * trade for the thing it is actually here to stop -- a single client hammering
 * sign-in, registration, uploads or message POSTs from one address -- and it
 * needs no Redis to do it. If you scale out, move `hit` onto a shared store;
 * every call site stays the same.
 *
 * It is deliberately not a security boundary on its own. Authorization is
 * enforced in lib/authz.ts; this only bounds cost and brute-force rate.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

// Bound the map so a flood of distinct keys cannot grow it without limit.
const MAX_TRACKED_KEYS = 20_000;

function sweep(now: number) {
  if (windows.size < MAX_TRACKED_KEYS) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Still full of live windows: drop the oldest insertions (Map preserves order).
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

export function hit(key: string, limit: number, windowMs: number): RateLimitResult {
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

/**
 * Header that server.ts stamps with the TCP peer address, after deleting any
 * inbound copy. Because we set it from the socket rather than believing the
 * client, it is trustworthy without a proxy in front.
 */
export const CLIENT_IP_HEADER = "x-thrum-client-ip";

/**
 * Client address for per-address limits.
 *
 * The ordering matters. X-Forwarded-For is only consulted when TRUST_PROXY=1,
 * because any client can send that header -- trusting it unconditionally would
 * let an attacker mint a fresh identity per request and walk through every
 * limit below. Behind a reverse proxy, set TRUST_PROXY=1 and make sure the
 * proxy *overwrites* rather than appends to it.
 *
 * Falling back to a single shared bucket would be worse than no limit at all:
 * one attacker could exhaust the sign-in quota and lock every legitimate user
 * out, turning a brute-force defence into a denial of service. So the socket
 * address from server.ts is the floor, and "unknown" is only reached when the
 * handler is invoked outside that server (a test, a script).
 */
export function clientAddress(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers.get("x-forwarded-for");
    // Left-most entry is the original client when the proxy overwrites it.
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;

    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }

  const peer = req.headers.get(CLIENT_IP_HEADER)?.trim();
  if (peer) return peer;

  return "unknown";
}

export const LIMITS = {
  /** Password guessing against a known address. */
  signIn: { limit: 10, windowMs: 10 * 60_000 },
  /** Account creation from one address. */
  register: { limit: 5, windowMs: 60 * 60_000 },
  /** Message sends per user. Generous: real chat is bursty. */
  sendMessage: { limit: 60, windowMs: 60_000 },
  /** Uploads per user. */
  upload: { limit: 20, windowMs: 10 * 60_000 },
  /** Channel and workspace creation per user. */
  createResource: { limit: 20, windowMs: 60 * 60_000 },
  /** Invite minting per user. */
  createInvite: { limit: 20, windowMs: 60 * 60_000 },
  /** Invite redemption attempts per address -- stops code guessing. */
  redeemInvite: { limit: 10, windowMs: 10 * 60_000 },
  /** Search is the most expensive read we expose. */
  search: { limit: 60, windowMs: 60_000 },
} as const;

/** Applies a named limit, throwing 429 when exceeded. */
export function enforce(
  name: keyof typeof LIMITS,
  identity: string,
): void {
  const { limit, windowMs } = LIMITS[name];
  const result = hit(`${name}:${identity}`, limit, windowMs);
  if (result.ok) return;

  throw new HttpError(
    429,
    `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
  );
}
