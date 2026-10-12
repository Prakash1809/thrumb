import { badRequest, readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { deliverNotifications, recordMentions, resolveMentions } from "@/lib/notify";
import { enforce } from "@/lib/rate-limit";
import { emitToChannel } from "@/lib/realtime";
import { messageInclude, toMessageDTO } from "@/lib/serialize";
import { sendMessageSchema } from "@/lib/validation";

type Params = { params: Promise<{ channelId: string }> };

const PAGE_SIZE = 40;

export const GET = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { channelId } = await params;
  await requireChannelAccess(user.id, channelId);

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? PAGE_SIZE) || PAGE_SIZE, 100);

  // Keyset pagination, newest first, then reversed for display. Offset paging
  // would shift rows under the reader every time someone posts.
  const rows = await db.message.findMany({
    where: { channelId, parentId: null },
    include: messageInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return Response.json({
    messages: page.map((row) => toMessageDTO(row)).reverse(),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
});

export const POST = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  await enforce("sendMessage", user.id);

  const { channelId } = await params;
  const { channel } = await requireChannelAccess(user.id, channelId);

  const { body, parentId, attachments, clientId } = sendMessageSchema.parse(await readJson(req));

  // Attachment keys are minted by /api/upload under a workspace prefix. Pinning
  // them to this workspace stops a crafted key from attaching someone else's
  // file to a message here.
  for (const attachment of attachments) {
    if (!attachment.key.startsWith(`${channel.workspaceId}/`)) {
      throw badRequest("Attachment does not belong to this workspace");
    }
  }

  if (parentId) {
    const parent = await db.message.findUnique({
      where: { id: parentId },
      select: { channelId: true, parentId: true, deletedAt: true },
    });
    if (!parent || parent.channelId !== channelId) throw badRequest("Thread parent not found");
    // Threads are one level deep, same as Slack: replying to a reply replies to
    // the thread, so a nested parent is a client bug worth surfacing.
    if (parent.parentId) throw badRequest("Replies cannot start their own thread");
    if (parent.deletedAt) throw badRequest("That message was deleted");
  }

  const created = await db.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        workspaceId: channel.workspaceId,
        channelId,
        userId: user.id,
        body: body.trim(),
        parentId: parentId ?? null,
        attachments: attachments.length
          ? {
              create: attachments.map((a) => ({
                key: a.key,
                name: a.name,
                mimeType: a.mimeType,
                size: a.size,
                width: a.width ?? null,
                height: a.height ?? null,
              })),
            }
          : undefined,
      },
      include: messageInclude,
    });

    // Denormalised counters keep the channel list and thread affordance free of
    // subqueries. They are updated in the same transaction as the insert.
    if (parentId) {
      await tx.message.update({
        where: { id: parentId },
        data: { replyCount: { increment: 1 }, lastReplyAt: message.createdAt },
      });
    } else {
      await tx.channel.update({
        where: { id: channelId },
        data: { lastMessageAt: message.createdAt },
      });
    }

    // Sending is reading: the author should never see their own message unread.
    await tx.channelMember.update({
      where: { channelId_userId: { channelId, userId: user.id } },
      data: { lastReadAt: message.createdAt },
    });

    return message;
  });

  const dto = toMessageDTO(created, clientId);
  const emit = emitToChannel(channelId);
  emit("message:new", dto);

  // The parent's reply count and participant strip changed, so the channel
  // transcript needs the refreshed row too.
  if (parentId) {
    const parent = await db.message.findUnique({ where: { id: parentId }, include: messageInclude });
    if (parent) emit("message:update", toMessageDTO(parent));
  }

  /**
   * Mentions and notifications happen after the response is prepared and are
   * not awaited into the critical path: the message is already committed and
   * broadcast, so a slow preference lookup must not delay the sender's 201.
   * Unread badges are the durable signal; a dropped desktop notification is
   * recoverable, a delayed send is not.
   */
  void (async () => {
    try {
      const resolution = await resolveMentions(created.body, channelId);

      await recordMentions({
        messageId: created.id,
        channelId,
        workspaceId: channel.workspaceId,
        authorId: user.id,
        mentionedUserIds: resolution.mentionedUserIds,
      });

      await deliverNotifications({
        message: { id: created.id, body: created.body },
        channel: {
          id: channel.id,
          workspaceId: channel.workspaceId,
          type: channel.type,
          name: channel.name,
        },
        author: created.user,
        mentions: resolution,
      });
    } catch (err) {
      console.error("[notify]", err);
    }
  })();

  return Response.json({ message: dto }, { status: 201 });
});
