import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Unread top-level message counts per channel, for one viewer, in one query.
 *
 * Doing this per channel would be a query per sidebar row. The join against
 * ChannelMember lets Postgres compare each message against that channel's own
 * lastReadAt, which is why this cannot be a plain Prisma groupBy.
 *
 * Thread replies are deliberately excluded: Slack surfaces those in the Threads
 * view, not as channel unreads.
 */
export async function unreadCounts(userId: string, workspaceId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ channelId: string; count: number }[]>(Prisma.sql`
    SELECT m."channelId" AS "channelId", COUNT(*)::int AS "count"
    FROM "Message" m
    JOIN "ChannelMember" cm
      ON cm."channelId" = m."channelId"
     AND cm."userId" = ${userId}
    WHERE m."workspaceId" = ${workspaceId}
      AND m."parentId" IS NULL
      AND m."deletedAt" IS NULL
      AND m."userId" <> ${userId}
      AND m."createdAt" > cm."lastReadAt"
    GROUP BY m."channelId"
  `);

  return new Map(rows.map((r) => [r.channelId, Number(r.count)]));
}
