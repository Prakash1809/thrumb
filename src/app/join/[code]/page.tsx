import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { JoinWorkspace } from "@/components/join-workspace";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { INVITE_CODE_PATTERN, hashInviteCode, inviteState } from "@/lib/invites";

export const metadata = { title: "Join a workspace · Thrum" };

type Props = { params: Promise<{ code: string }> };

export default async function JoinPage({ params }: Props) {
  const { code } = await params;

  const user = await currentUser();
  // Signing in has to come first: joining attributes a membership to an
  // account. The code rides along in `next` so the link survives the detour.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);

  const invite = INVITE_CODE_PATTERN.test(code)
    ? await db.workspaceInvite.findUnique({
        where: { codeHash: hashInviteCode(code) },
        select: {
          role: true,
          maxUses: true,
          uses: true,
          expiresAt: true,
          revokedAt: true,
          workspaceId: true,
          workspace: { select: { name: true, _count: { select: { members: true } } } },
        },
      })
    : null;

  if (!invite) {
    return (
      <AuthShell
        title="This invite is not valid"
        subtitle="The link may have been mistyped, or revoked by an admin."
        footer={<>Ask whoever shared it for a fresh link.</>}
      >
        <a
          href="/w"
          className="focus-ring block rounded-md bg-[var(--color-accent)] px-3 py-2 text-center text-sm font-semibold text-[var(--color-accent-ink)]"
        >
          Back to your workspaces
        </a>
      </AuthShell>
    );
  }

  // Already a member: no reason to make them click anything.
  const existing = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
    select: { id: true },
  });
  if (existing) redirect(`/w/${invite.workspaceId}`);

  const state = inviteState(invite);

  return (
    <AuthShell
      title={`Join ${invite.workspace.name}`}
      subtitle={
        state.usable
          ? `You have been invited as a ${invite.role.toLowerCase()}. ${invite.workspace._count.members} people are already here.`
          : state.reason
      }
      footer={<>Signed in as {user.email}</>}
    >
      {state.usable ? (
        <JoinWorkspace code={code} workspaceName={invite.workspace.name} />
      ) : (
        <a
          href="/w"
          className="focus-ring block rounded-md border border-[var(--color-line)] px-3 py-2 text-center text-sm font-semibold"
        >
          Back to your workspaces
        </a>
      )}
    </AuthShell>
  );
}
