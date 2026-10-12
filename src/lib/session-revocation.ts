import { db } from "@/lib/db";

/**
 * Revocation for stateless sessions.
 *
 * Sessions are JWTs, so there is nothing to delete server-side. Instead each
 * user carries a `sessionsRevokedAt` instant, and a token whose issue time
 * predates it is refused.
 *
 * The obvious implementation reads that column on every authenticated request,
 * which at a thousand users is a database round trip per request for a value
 * that changes approximately never. So it is cached per process with a short
 * TTL: the cost is one read per user per TTL window, and the exposure is that
 * a revocation can take up to that long to be felt. Thirty seconds of lag on
 * logging out a compromised session is a good trade for not adding a query to
 * every page load; a longer window would not be.
 */

const CACHE_TTL_MS = 30_000;

type Entry = { revokedAt: number | null; checkedAt: number };

const cache = new Map<string, Entry>();
const MAX_CACHE_ENTRIES = 20_000;

function remember(userId: string, revokedAt: number | null) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Drop the oldest insertions rather than growing without bound.
    let toDrop = Math.ceil(cache.size * 0.1);
    for (const key of cache.keys()) {
      cache.delete(key);
      if (--toDrop <= 0) break;
    }
  }
  cache.set(userId, { revokedAt, checkedAt: Date.now() });
}

/**
 * True when a token issued at `issuedAtSeconds` should no longer be honoured.
 *
 * A token with no `iat` is treated as revoked whenever the user has a
 * revocation stamp at all: we cannot prove it was issued afterwards, and
 * failing closed is the only safe direction for a credential check.
 */
export async function isSessionRevoked(
  userId: string,
  issuedAtSeconds: number | undefined,
): Promise<boolean> {
  const cached = cache.get(userId);

  let revokedAt: number | null;

  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    revokedAt = cached.revokedAt;
  } else {
    try {
      const row = await db.user.findUnique({
        where: { id: userId },
        select: { sessionsRevokedAt: true, deactivatedAt: true },
      });

      // A missing or deactivated user invalidates the session outright.
      if (!row || row.deactivatedAt) {
        remember(userId, Date.now());
        return true;
      }

      revokedAt = row.sessionsRevokedAt?.getTime() ?? null;
      remember(userId, revokedAt);
    } catch {
      // A database blip must not sign everyone out. Honour the last known
      // answer, or allow if we have never had one.
      revokedAt = cached?.revokedAt ?? null;
    }
  }

  if (revokedAt === null) return false;
  if (issuedAtSeconds === undefined) return true;

  // `iat` is in seconds; allow a second of slack so a token minted in the same
  // instant as a revocation is not caught by rounding.
  return issuedAtSeconds * 1000 < revokedAt - 1000;
}

/** Marks every session issued up to now as invalid, and clears the cache entry. */
export async function revokeSessions(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { sessionsRevokedAt: new Date() },
  });
  // Drop the cached answer so this instance notices immediately. Other
  // instances pick it up within the TTL.
  cache.delete(userId);
}
