import { forbidden, notFound, readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { emitToChannel } from "@/lib/realtime";
import { messageInclude, toMessageDTO } from "@/lib/serialize";
import { editMessageSchema } from "@/lib/validation";

type Params = { params: Promise<{ messageId: string }> };

/** Loads a message the viewer can see, and asserts they wrote it. */
async function requireOwnMessage(userId: string, messageId: string) {
  const message = await db.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, userId: true, parentId: true, deletedAt: true },
  });
  if (!message) throw notFound("Message not found");

  // Channel access is checked before ownership so a stranger probing ids learns
  // nothing about messages in channels they cannot read.
  await requireChannelAccess(userId, message.channelId);

  if (message.userId !== userId) throw forbidden("You can only change your own messages");
  if (message.deletedAt) throw notFound("Message not found");

  return message;
}

export const PATCH = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { messageId } = await params;
  await requireOwnMessage(user.id, messageId);

  const { body } = editMessageSchema.parse(await readJson(req));

  const updated = await db.message.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
    include: messageInclude,
  });

  const dto = toMessageDTO(updated);
  emitToChannel(updated.channelId)("message:update", dto);

  return Response.json({ message: dto });
});

export const DELETE = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { messageId } = await params;
  await requireOwnMessage(user.id, messageId);

  // Soft delete. The row stays so thread ordering, reply counts and the
  // position of surrounding messages do not shift under anyone mid-read; the
  // body and attachments are withheld by toMessageDTO and the UI renders a
  // tombstone. Attachment rows are dropped outright since nothing can show them.
  const deleted = await db.$transaction(async (tx) => {
    await tx.attachment.deleteMany({ where: { messageId } });
    await tx.reaction.deleteMany({ where: { messageId } });
    return tx.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: "" },
      include: messageInclude,
    });
  });

  const dto = toMessageDTO(deleted);
  emitToChannel(deleted.channelId)("message:update", dto);

  return Response.json({ message: dto });
});
