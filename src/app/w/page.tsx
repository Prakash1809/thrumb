import { redirect } from "next/navigation";

import { WorkspacePicker } from "@/components/workspace-picker";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Workspaces · Thrum" };

export default async function WorkspacesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/w");

  // Only the viewer's own memberships. Workspaces are not enumerable: listing
  // every one on the instance told any account what else was hosted here, and
  // paired with self-join it let them walk in.
  const mine = await db.workspaceMember.findMany({
    where: { userId: user.id },
    select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
    orderBy: { joinedAt: "asc" },
  });

  // Exactly one workspace and nothing to choose between: skip the picker.
  if (mine.length === 1) redirect(`/w/${mine[0].workspace.id}`);

  return (
    <WorkspacePicker
      viewerName={user.name ?? "there"}
      workspaces={mine.map((m) => ({ ...m.workspace, role: m.role }))}
    />
  );
}
