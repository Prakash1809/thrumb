import { Prisma } from "@prisma/client";

import { badRequest, notFound, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { INVITE_CODE_PATTERN, hashInviteCode, inviteState } from "@/lib/invites";
import { clientAddress, enforce } from "@/lib/rate-limit";

type Params = { params: Promise<{ code: string }> };

/**
 * Looks an invite up by the digest of the presented code. The plaintext is
 * never stored, so this is the only way to resolve one.
 */
async function findInvite(code: string) {
  if (!INVITE_CODE_PATTERN.test(code)) return null;

  return db.workspaceInvite.findUnique({
    where: { codeHash: hashInviteCode(code) },
    select: {
      id: true,
      workspaceId: true,
      role: true,
      maxUses: true,
      uses: true,
      expiresAt: true,
      revokedAt: true,
      workspace: { select: { id: true, name: true, _count: { select: { members: true } } } },
    },
  });
}

/**
 * Previews an invite so the join page can name the workspace before someone
 * commits. Consumes nothing.
 *
 * Rate limited per address: without that, this endpoint is an oracle for
 * brute-forcing codes. (160 bits of entropy already makes that hopeless; the
 * limit means it is not even worth the attempt, and bounds the cost to us.)
 */
export const GET = route(async (req: Request, { params }: Params) => {
  await requireUser();
  const { code } = await params;
  enforce("redeemInvite", clientAddress(req));

  const invite = await findInvite(code);
  if (!invite) throw notFound("That invite link is not valid.");

  const state = inviteState(invite);

  return Response.json({
    workspace: {
      id: invite.workspace.id,
      name: invite.workspace.name,
      memberCount: invite.workspace._count.members,
    },
    role: invite.role,
    usable: state.usable,
    reason: state.usable ? null : state.reason,
  });
});

/** Redeems an invite, joining the caller to the workspace. */
export const POST = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { code } = await params;
  enforce("redeemInvite", clientAddress(req));

  const invite = await findInvite(code);
  if (!invite) throw notFound("That invite link is not valid.");

  const existing = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
    select: { id: true },
  });

  // Already a member: succeed without burning a use, so re-opening the link
  // does not silently exhaust a single-use invite.
  if (!existing) {
    const state = inviteState(invite);
    if (!state.usable) throw badRequest(state.reason);

    /**
     * Claim a use atomically.
     *
     * The guard has to live in the UPDATE's WHERE clause: checking
     * `uses < maxUses` in application code and then incrementing lets two
     * concurrent redemptions both pass the check and overshoot the limit. This
     * is raw SQL because the condition compares two columns to each other,
     * which Prisma's query builder cannot express.
     */
    const claimed = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "WorkspaceInvite"
         SET "uses" = "uses" + 1
       WHERE "id" = ${invite.id}
         AND "revokedAt" IS NULL
         AND ("expiresAt" IS NULL OR "expiresAt" > now())
         AND ("maxUses" = 0 OR "uses" < "maxUses")
      RETURNING "id"
    `);

    if (claimed.length === 0) {
      throw badRequest("That invite is no longer usable.");
    }

    await db.workspaceMember.create({
      data: {
        workspaceId: invite.workspaceId,
        userId: user.id,
        // The invite carries the role, so an admin can mint an admin invite
        // without a second step. It can never exceed ADMIN -- OWNER is not an
        // option in createInviteSchema.
        role: invite.role,
      },
    });
  }

  // Land the new member in the workspace's first public channel.
  const general = await db.channel.findFirst({
    where: { workspaceId: invite.workspaceId, type: "PUBLIC" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (general) {
    await db.channelMember.upsert({
      where: { channelId_userId: { channelId: general.id, userId: user.id } },
      create: { channelId: general.id, userId: user.id },
      update: {},
    });
  }

  return Response.json({
    workspaceId: invite.workspaceId,
    channelId: general?.id ?? null,
  });
});
