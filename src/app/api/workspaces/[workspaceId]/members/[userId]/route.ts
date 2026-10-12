import { badRequest, forbidden, notFound, readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { emitToUsers, removeUserFromWorkspaceRooms } from "@/lib/realtime";
import { revokeSessions } from "@/lib/session-revocation";
import { updateMemberSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string; userId: string }> };

/**
 * Owners are protected from each other and from themselves.
 *
 * Two invariants: a workspace always has at least one owner (otherwise nobody
 * can ever administer it again), and only an owner may create or remove
 * another owner -- an admin who could promote themselves to owner, or demote
 * the owner, would simply be an owner with extra steps.
 */
async function assertOwnerInvariants({
  workspaceId,
  actorRole,
  targetRole,
  nextRole,
}: {
  workspaceId: string;
  actorRole: "OWNER" | "ADMIN" | "MEMBER";
  targetRole: "OWNER" | "ADMIN" | "MEMBER";
  nextRole: "OWNER" | "ADMIN" | "MEMBER" | null;
}) {
  const touchesOwnership = targetRole === "OWNER" || nextRole === "OWNER";

  if (touchesOwnership && actorRole !== "OWNER") {
    throw forbidden("Only an owner can add or remove another owner");
  }

  // Removing or demoting the last owner would strand the workspace.
  if (targetRole === "OWNER" && nextRole !== "OWNER") {
    const owners = await db.workspaceMember.count({ where: { workspaceId, role: "OWNER" } });
    if (owners <= 1) {
      throw badRequest("This is the only owner. Promote someone else to owner first.");
    }
  }
}

/** Changes a member's role. */
export const PATCH = route(async (req: Request, { params }: Params) => {
  const actor = await requireUser();
  const { workspaceId, userId } = await params;

  const actorMembership = await requireWorkspaceAdmin(actor.id, workspaceId);
  const { role } = updateMemberSchema.parse(await readJson(req));

  const target = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (!target) throw notFound("That person is not in this workspace");

  await assertOwnerInvariants({
    workspaceId,
    actorRole: actorMembership.role,
    targetRole: target.role,
    nextRole: role,
  });

  await db.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId, userId } },
    data: { role },
  });

  // Their client gates admin affordances on this, so tell it immediately
  // rather than waiting for a reload.
  emitToUsers([userId])("membership:update", { workspaceId, role });

  return Response.json({ userId, role });
});

/**
 * Removes someone from a workspace.
 *
 * Their messages stay: deleting them would tear holes in every thread they
 * ever replied to, and the point of this endpoint is revoking access, not
 * rewriting history. What goes is membership -- of the workspace and of every
 * channel in it -- plus their live socket subscriptions, so access ends now
 * rather than whenever they next reconnect.
 *
 * `?deactivate=1` additionally disables the account instance-wide, which is
 * what you want for someone leaving the company rather than just the project.
 */
export const DELETE = route(async (req: Request, { params }: Params) => {
  const actor = await requireUser();
  const { workspaceId, userId } = await params;

  const actorMembership = await requireWorkspaceAdmin(actor.id, workspaceId);

  const url = new URL(req.url);
  const deactivate = url.searchParams.get("deactivate") === "1";

  const target = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (!target) throw notFound("That person is not in this workspace");

  await assertOwnerInvariants({
    workspaceId,
    actorRole: actorMembership.role,
    targetRole: target.role,
    nextRole: null,
  });

  if (deactivate && actorMembership.role !== "OWNER") {
    throw forbidden("Only an owner can deactivate an account");
  }

  const channelIds = await db.$transaction(async (tx) => {
    // Channel memberships are scoped to this workspace's channels only -- the
    // person may legitimately belong to other workspaces on this instance.
    const channels = await tx.channel.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const ids = channels.map((c) => c.id);

    await tx.channelMember.deleteMany({
      where: { userId, channelId: { in: ids } },
    });

    await tx.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    });

    if (deactivate) {
      await tx.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } });
      // Outstanding reset links must not survive a deactivation.
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
    }

    return ids;
  });

  // A deactivated account must lose the session it is holding right now, not
  // just the ability to sign in again.
  if (deactivate) await revokeSessions(userId);

  await removeUserFromWorkspaceRooms(workspaceId, userId, channelIds);
  emitToUsers([userId])("membership:update", { workspaceId, role: null });

  return Response.json({ userId, removed: true, deactivated: deactivate });
});
