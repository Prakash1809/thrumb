import { getRedis } from "@/lib/redis";

/**
 * Who is online, across every app instance.
 *
 * Presence is reference-counted per user rather than a boolean: one person
 * with three tabs is online once, and closing one tab must not mark them away.
 * With Redis that count is a hash field shared by all instances; without it,
 * a local Map.
 *
 * Entries carry a TTL so a hard crash cannot leave someone online forever --
 * an instance that dies without running its disconnect handlers would
 * otherwise strand its users in the set permanently.
 */

const ONLINE_KEY = "presence:online";
const TTL_SECONDS = 90;

const localCounts = new Map<string, number>();

export type PresenceDelta = { online: boolean; changed: boolean };

/** Registers a connection. `changed` is true only on the first one. */
export async function addPresence(userId: string): Promise<PresenceDelta> {
  const redis = getRedis();

  if (!redis) {
    const next = (localCounts.get(userId) ?? 0) + 1;
    localCounts.set(userId, next);
    return { online: true, changed: next === 1 };
  }

  try {
    const count = await redis.hincrby(ONLINE_KEY, userId, 1);
    await redis.expire(ONLINE_KEY, TTL_SECONDS * 10);
    return { online: true, changed: count === 1 };
  } catch {
    const next = (localCounts.get(userId) ?? 0) + 1;
    localCounts.set(userId, next);
    return { online: true, changed: next === 1 };
  }
}

/** Deregisters a connection. `changed` is true only on the last one. */
export async function removePresence(userId: string): Promise<PresenceDelta> {
  const redis = getRedis();

  if (!redis) {
    const next = Math.max(0, (localCounts.get(userId) ?? 0) - 1);
    if (next === 0) localCounts.delete(userId);
    else localCounts.set(userId, next);
    return { online: next > 0, changed: next === 0 };
  }

  try {
    const count = await redis.hincrby(ONLINE_KEY, userId, -1);
    if (count <= 0) {
      await redis.hdel(ONLINE_KEY, userId);
      return { online: false, changed: true };
    }
    return { online: true, changed: false };
  } catch {
    const next = Math.max(0, (localCounts.get(userId) ?? 0) - 1);
    if (next === 0) localCounts.delete(userId);
    else localCounts.set(userId, next);
    return { online: next > 0, changed: next === 0 };
  }
}

/**
 * Every online user id.
 *
 * Returned wholesale rather than intersected against the viewer's workspace
 * members: that intersection used to be a database read of every member row on
 * each connect, which at a thousand users is a million rows read per full
 * reconnect wave. The set is bounded by concurrent connections, the client
 * only looks up ids it already knows about, and online-ness is not sensitive.
 */
export async function onlineUserIds(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [...localCounts.keys()];

  try {
    return Object.keys(await redis.hgetall(ONLINE_KEY));
  } catch {
    return [...localCounts.keys()];
  }
}

export async function isOnline(userId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return (localCounts.get(userId) ?? 0) > 0;

  try {
    const value = await redis.hget(ONLINE_KEY, userId);
    return Number(value ?? 0) > 0;
  } catch {
    return (localCounts.get(userId) ?? 0) > 0;
  }
}

/**
 * Clears this instance's contribution to the shared set.
 *
 * Called on graceful shutdown. Without it, a rolling deploy would leave the
 * departing instance's users counted as online until the TTL expired.
 */
export async function releaseLocalPresence(): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    localCounts.clear();
    return;
  }

  const entries = [...localCounts.entries()];
  localCounts.clear();
  if (entries.length === 0) return;

  try {
    const pipeline = redis.multi();
    for (const [userId, count] of entries) pipeline.hincrby(ONLINE_KEY, userId, -count);
    await pipeline.exec();
  } catch {
    // Nothing useful to do during shutdown; the TTL is the backstop.
  }
}

/** Records a connection locally too, so shutdown can undo it in Redis. */
export function trackLocal(userId: string, delta: number): void {
  if (!getRedis()) return;
  const next = (localCounts.get(userId) ?? 0) + delta;
  if (next <= 0) localCounts.delete(userId);
  else localCounts.set(userId, next);
}
