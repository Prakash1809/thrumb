import { route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { userSelect } from "@/lib/serialize";

type Params = { params: Promise<{ workspaceId: string }> };

export const GET = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    select: { role: true, joinedAt: true, user: { select: userSelect } },
    orderBy: { user: { name: "asc" } },
  });

  return Response.json({
    members: members.map((m) => ({ ...m.user, role: m.role })),
  });
});
