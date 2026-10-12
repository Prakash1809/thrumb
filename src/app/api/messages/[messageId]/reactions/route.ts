import { notFound, readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { emitToChannel } from "@/lib/realtime";
import { groupReactions } from "@/lib/serialize";
import { reactionSchema } from "@/lib/validation";

type Params = { params: Promise<{ messageId: string }> };

/**
 * Toggles one emoji for the calling user. A single endpoint rather than
 * add/remove pairs, so a double-click cannot leave the UI and the database
 * disagreeing about whether the reaction is on.
 */
export const POST = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { messageId } = await params;
  const { emoji } = reactionSchema.parse(await readJson(req));

  const message = await db.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, parentId: true, deletedAt: true },
  });
  if (!message || message.deletedAt) throw notFound("Message not found");

  await requireChannelAccess(user.id, message.channelId);

  const existing = await db.reaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: user.id, emoji } },
    select: { id: true },
  });

  if (existing) await db.reaction.delete({ where: { id: existing.id } });
  else await db.reaction.create({ data: { messageId, userId: user.id, emoji } });

  const rows = await db.reaction.findMany({
    where: { messageId },
    select: { emoji: true, userId: true },
  });
  const reactions = groupReactions(rows);

  emitToChannel(message.channelId)("reaction:update", {
    messageId,
    channelId: message.channelId,
    parentId: message.parentId,
    reactions,
  });

  return Response.json({ messageId, reactions });
});
