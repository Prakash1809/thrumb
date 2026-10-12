import { badRequest, forbidden, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess, requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { emitToUsers, removeUsersFromChannelRoom } from "@/lib/realtime";

type Params = { params: Promise<{ channelId: string; userId: string }> };

/**
 * Removes someone else from a channel.
 *
 * Removing *yourself* is a different operation with different rules, and lives
 * at /api/channels/[channelId]/membership. This one is for admins and the
 * channel's creator: being in a channel is not authority to evict the people
 * already in it.
 */
export const DELETE = route(async (_req: Request, { params }: Params) => {
  const actor = await requireUser();
  const { channelId, userId } = await params;

  const { channel } = await requireChannelAccess(actor.id, channelId);

  if (channel.type === "DM" || channel.type === "GROUP") {
    throw badRequest("You cannot remove people from a direct message");
  }

  const membership = await requireWorkspaceMember(actor.id, channel.workspaceId);
  const isAdmin = membership.role !== "MEMBER";
  const isCreator = channel.createdById === actor.id;

  if (!isAdmin && !isCreator) {
    throw forbidden("Only an admin or the channel's creator can remove members");
  }

  if (userId === actor.id) {
    throw badRequest("Use the leave-channel action to remove yourself");
  }

  const removed = await db.channelMember.deleteMany({ where: { channelId, userId } });
  if (removed.count === 0) throw badRequest("That person is not in this channel");

  // Their socket is still in the room until told otherwise.
  await removeUsersFromChannelRoom(channelId, [userId]);
  emitToUsers([userId])("channel:removed", { channelId });

  return Response.json({ channelId, userId, removed: true });
});
