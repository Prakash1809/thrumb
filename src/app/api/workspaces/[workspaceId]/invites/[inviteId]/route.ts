import { notFound, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceAdmin } from "@/lib/authz";
import { db } from "@/lib/db";

type Params = { params: Promise<{ workspaceId: string; inviteId: string }> };

/** Revokes an invite. Soft, so the audit trail of who minted it survives. */
export const DELETE = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId, inviteId } = await params;
  await requireWorkspaceAdmin(user.id, workspaceId);

  // Scoping the update by workspaceId as well as id stops an admin of one
  // workspace revoking another workspace's invite by guessing its id.
  const { count } = await db.workspaceInvite.updateMany({
    where: { id: inviteId, workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (count === 0) throw notFound("Invite not found");

  return Response.json({ inviteId, revoked: true });
});
