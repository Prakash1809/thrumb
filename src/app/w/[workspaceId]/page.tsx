import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

/** Landing on a workspace drops you into a channel rather than an empty pane. */
export default async function WorkspaceIndexPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/w/${workspaceId}`);

  const joined = await db.channel.findFirst({
    where: { workspaceId, members: { some: { userId: user.id } } },
    select: { id: true },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  if (joined) redirect(`/w/${workspaceId}/c/${joined.id}`);

  const anyPublic = await db.channel.findFirst({
    where: { workspaceId, type: "PUBLIC" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (anyPublic) redirect(`/w/${workspaceId}/c/${anyPublic.id}`);

  return (
    <div className="grid flex-1 place-items-center p-10 text-center">
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight">No channels yet</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Create one from the <strong>+</strong> next to Channels in the sidebar to get started.
        </p>
      </div>
    </div>
  );
}
