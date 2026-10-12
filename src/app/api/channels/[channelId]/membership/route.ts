import { badRequest, notFound, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { getChannelDTO } from "@/lib/channels";
import { db } from "@/lib/db";
import { emitToUsers, removeUsersFromChannelRoom } from "@/lib/realtime";

type Params = { params: Promise<{ channelId: string }> };

/**
 * Leaves a channel.
 *
 * Reading a public channel joins it automatically, so without this the Browse
 * list would be a one-way door.
 */
export const DELETE = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { channelId } = await params;

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, workspaceId: true, type: true },
  });
  if (!channel) throw notFound("Channel not found");

  // A DM has no concept of leaving -- the conversation is the pair.
  if (channel.type === "DM" || channel.type === "GROUP") {
    throw badRequest("You cannot leave a direct message");
  }

  await requireWorkspaceMember(user.id, channel.workspaceId);

  const removed = await db.channelMember.deleteMany({ where: { channelId, userId: user.id } });
  if (removed.count === 0) throw badRequest("You are not in this channel");

  await removeUsersFromChannelRoom(channelId, [user.id]);

  // Tell this user's other tabs, then hand back the channel as a non-member so
  // a public one reappears in Browse rather than vanishing until a reload.
  emitToUsers([user.id])("channel:removed", { channelId });

  if (channel.type === "PUBLIC") {
    const dto = await getChannelDTO(user.id, channelId);
    emitToUsers([user.id])("channel:upsert", dto);
  }

  return Response.json({ channelId });
});
