import { db } from "@/lib/db";
import { getRedis, redisEnabled } from "@/lib/redis";

/**
 * Liveness and readiness for a container orchestrator or load balancer.
 *
 * Unauthenticated on purpose -- a health probe cannot hold a session -- so it
 * deliberately reveals nothing beyond up/down per dependency. No version
 * string, no hostname, no connection counts: that is reconnaissance, and this
 * is the one endpoint guaranteed to be reachable.
 *
 * Redis being down is reported but does not fail the check: the app degrades
 * to in-memory rate limits and presence rather than stopping, so taking the
 * instance out of rotation would make an outage worse.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | "down" | "disabled"> = {
    database: "down",
    redis: redisEnabled() ? "down" : "disabled",
  };

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    // Left as "down".
  }

  const redis = getRedis();
  if (redis) {
    try {
      await redis.ping();
      checks.redis = "ok";
    } catch {
      // Left as "down".
    }
  }

  const healthy = checks.database === "ok";

  return Response.json(
    { status: healthy ? "ok" : "degraded", checks },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
