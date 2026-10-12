import { readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { enforce } from "@/lib/rate-limit";
import { uniqueSlug } from "@/lib/slug";
import { createWorkspaceSchema } from "@/lib/validation";

/**
 * The workspaces this user belongs to -- and nothing else.
 *
 * This endpoint used to also return every workspace on the instance so people
 * could self-join one. That made any authenticated account a membership request
 * away from reading every public channel in every workspace, which is a data
 * breach by design the moment the instance is reachable from the internet.
 * Joining now requires an invite code; see /api/invites/[code].
 */
export const GET = route(async () => {
  const user = await requireUser();

  const mine = await db.workspaceMember.findMany({
    where: { userId: user.id },
    select: {
      role: true,
      workspace: { select: { id: true, name: true, slug: true, createdAt: true } },
    },
    orderBy: { joinedAt: "asc" },
  });

  return Response.json({
    workspaces: mine.map((m) => ({ ...m.workspace, role: m.role })),
  });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  enforce("createResource", user.id);

  const { name } = createWorkspaceSchema.parse(await readJson(req));

  const slug = await uniqueSlug(name, async (candidate) =>
    Boolean(await db.workspace.findUnique({ where: { slug: candidate }, select: { id: true } })),
  );

  // Creator becomes owner and lands in a #general channel, so the workspace is
  // never a dead end on first load.
  const workspace = await db.workspace.create({
    data: {
      name,
      slug,
      members: { create: { userId: user.id, role: "OWNER" } },
      channels: {
        create: {
          type: "PUBLIC",
          name: "general",
          topic: "Company-wide announcements and work-based matters",
          createdById: user.id,
          members: { create: { userId: user.id } },
        },
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      channels: { select: { id: true }, take: 1 },
    },
  });

  return Response.json(
    {
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
      channelId: workspace.channels[0]?.id ?? null,
    },
    { status: 201 },
  );
});
