import Redis from "ioredis";

/**
 * Optional Redis.
 *
 * Three things have to leave process memory before a second app instance can
 * exist: rate-limit counters, the presence map, and Socket.IO's room fan-out.
 * All three degrade silently rather than loudly when they are per-process --
 * limits allow N times their quota, presence shows people offline, and a
 * message reaches only the instance that received it. So Redis is what makes
 * horizontal scaling correct, not merely faster.
 *
 * It stays optional: with no REDIS_URL the app runs exactly as before on a
 * single instance, which is the right default for a small install.
 */

const globalForRedis = globalThis as unknown as {
  __thrumRedis?: Redis | null;
  __thrumRedisSub?: Redis | null;
};

function create(url: string, label: string): Redis {
  const client = new Redis(url, {
    // Fail fast and keep retrying in the background rather than hanging a
    // request on a dead Redis.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    lazyConnect: false,
  });

  client.on("error", (err) => {
    // Logged once per failure, not thrown: callers are written to degrade.
    console.error(`[redis:${label}]`, err.message);
  });

  return client;
}

/** The main client, or null when Redis is not configured. */
export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (globalForRedis.__thrumRedis === undefined) {
    globalForRedis.__thrumRedis = create(url, "main");
  }
  return globalForRedis.__thrumRedis;
}

/**
 * A second connection for pub/sub. Redis puts a subscribed connection into a
 * mode where normal commands are refused, so the adapter needs its own.
 */
export function getRedisSubscriber(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (globalForRedis.__thrumRedisSub === undefined) {
    globalForRedis.__thrumRedisSub = create(url, "sub");
  }
  return globalForRedis.__thrumRedisSub;
}

export function redisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}
