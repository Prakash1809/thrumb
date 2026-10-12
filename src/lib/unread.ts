import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export type UnreadSummary = {
  /** channelId -> unread top-level message count. */
  counts: Map<string, number>;
  /** channelId -> unread mentions of the viewer in that channel. */
  mentions: Map<string, number>;
};

/**
 * Unread counts for one viewer, in one query per kind.
 *
 * Shape matters more than it looks. The obvious version scans the workspace's
 * messages and joins membership onto them, which makes the work proportional
 * to total message volume -- fine at ten thousand messages, not at ten million.
 *
 * This drives off the viewer's ChannelMember rows instead (tens of them) and
 * uses a LATERAL subquery so Postgres performs one bounded index range scan
 * per channel over (channelId, parentId, createdAt), starting at that
 * channel's own lastReadAt. The cost then tracks how much the viewer has not
 * read, not how much the workspace has ever said.
 *
 * The count is capped: past a few hundred the UI shows "99+" anyway, and
 * counting a channel someone abandoned a year ago exactly is wasted work.
 */
const UNREAD_CAP = 500;

export async function unreadSummary(
  userId: string,
  workspaceId: string,
): Promise<UnreadSummary> {
  const [countRows, mentionRows] = await Promise.all([
    db.$queryRaw<{ channelId: string; count: number }[]>(Prisma.sql`
      SELECT cm."channelId" AS "channelId", u."count"::int AS "count"
      FROM "ChannelMember" cm
      JOIN "Channel" c
        ON c."id" = cm."channelId"
       AND c."workspaceId" = ${workspaceId}
      CROSS JOIN LATERAL (
        SELECT COUNT(*) AS "count"
        FROM (
          SELECT 1
          FROM "Message" m
          WHERE m."channelId" = cm."channelId"
            AND m."parentId" IS NULL
            AND m."createdAt" > cm."lastReadAt"
            AND m."deletedAt" IS NULL
            AND m."userId" <> ${userId}
          LIMIT ${UNREAD_CAP}
        ) capped
      ) u
      WHERE cm."userId" = ${userId}
        AND u."count" > 0
    `),

    // Mentions are their own badge, and come from an indexed lookup on
    // (userId, readAt) rather than anything message-shaped.
    db.$queryRaw<{ channelId: string; count: number }[]>(Prisma.sql`
      SELECT "channelId", COUNT(*)::int AS "count"
      FROM "Mention"
      WHERE "userId" = ${userId}
        AND "workspaceId" = ${workspaceId}
        AND "readAt" IS NULL
      GROUP BY "channelId"
    `),
  ]);

  return {
    counts: new Map(countRows.map((r) => [r.channelId, Number(r.count)])),
    mentions: new Map(mentionRows.map((r) => [r.channelId, Number(r.count)])),
  };
}

/** Total unread mentions across a workspace, for the sidebar badge. */
export async function unreadMentionTotal(userId: string, workspaceId: string): Promise<number> {
  return db.mention.count({
    where: { userId, workspaceId, readAt: null },
  });
}
