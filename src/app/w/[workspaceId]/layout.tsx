import { notFound, redirect } from "next/navigation";

import { SocketProvider } from "@/components/socket-provider";
import { WorkspaceProvider, type WorkspaceMemberSummary } from "@/components/workspace-provider";
import { WorkspaceShell } from "@/components/workspace-shell";
import { currentUser } from "@/lib/auth";
import { listChannelsForUser } from "@/lib/channels";
import { db } from "@/lib/db";
import { userSelect } from "@/lib/serialize";

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>;
  children: React.ReactNode;
}) {
  const { workspaceId } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/w/${workspaceId}`);

  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
  });
  // A workspace the viewer is not in is indistinguishable from one that does
  // not exist, so membership and existence share one 404.
  if (!membership) notFound();

  const [{ joined, available }, members] = await Promise.all([
    listChannelsForUser(user.id, workspaceId),
    db.workspaceMember.findMany({
      where: { workspaceId },
      select: { role: true, user: { select: userSelect } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  // The sidebar is server-rendered with real data on first paint, then takes
  // over client-side from socket events -- no loading spinner on entry.
  return (
    <SocketProvider>
      <WorkspaceProvider
        workspace={membership.workspace}
        viewer={{ id: user.id, name: user.name ?? null, image: user.image ?? null }}
        viewerRole={membership.role}
        initialJoined={joined}
        initialAvailable={available}
        initialMembers={
          members.map((m) => ({ ...m.user, role: m.role })) as WorkspaceMemberSummary[]
        }
      >
        <WorkspaceShell>{children}</WorkspaceShell>
      </WorkspaceProvider>
    </SocketProvider>
  );
}
