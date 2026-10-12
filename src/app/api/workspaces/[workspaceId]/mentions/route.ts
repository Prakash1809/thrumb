import { readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { emitToUsers } from "@/lib/realtime";
import { messageInclude, toMessageDTO } from "@/lib/serialize";
import { mentionFeedSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string }> };

/**
 * Everything that named the viewer, newest first.
 *
 * Reads from the Mention table rather than searching message bodies: the whole
 * reason mentions are denormalised is so this view is an indexed lookup on
 * (userId, workspaceId, createdAt) instead of a full-text scan.
 */
export const GET = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const url = new URL(req.url);
  const { limit, cursor } = mentionFeedSchema.parse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  const rows = await db.mention.findMany({
    where: {
      userId: user.id,
      workspaceId,
      // A mention of a deleted message has nothing to show.
      message: { deletedAt: null },
    },
    select: {
      id: true,
      readAt: true,
      createdAt: true,
      channelId: true,
      message: { include: messageInclude },
      // The channel name for the row's header. Members are not needed: a
      // mention can only exist in a channel the viewer belongs to.
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const channelIds = [...new Set(page.map((r) => r.channelId))];
  const channels = await db.channel.findMany({
    where: { id: { in: channelIds } },
    select: { id: true, name: true, type: true },
  });
  const channelById = new Map(channels.map((c) => [c.id, c]));

  return Response.json({
    mentions: page.map((row) => ({
      id: row.id,
      readAt: row.readAt?.toISOString() ?? null,
      channelId: row.channelId,
      channelName: channelById.get(row.channelId)?.name ?? null,
      channelType: channelById.get(row.channelId)?.type ?? "PUBLIC",
      message: toMessageDTO(row.message),
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
});

/** Marks mentions read -- one channel's worth, or all of them. */
export const POST = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const body = (await readJson(req).catch(() => ({}))) as { channelId?: unknown };
  const channelId = typeof body.channelId === "string" ? body.channelId : null;

  await db.mention.updateMany({
    where: {
      userId: user.id,
      workspaceId,
      readAt: null,
      ...(channelId ? { channelId } : {}),
    },
    data: { readAt: new Date() },
  });

  // Other tabs should drop the badge too.
  if (channelId) {
    emitToUsers([user.id])("mentions:update", { channelId, unreadMentions: 0 });
  }

  const remaining = await db.mention.count({
    where: { userId: user.id, workspaceId, readAt: null },
  });

  return Response.json({ ok: true, remaining });
});
