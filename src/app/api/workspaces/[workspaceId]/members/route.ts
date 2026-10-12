import { route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { userSelect } from "@/lib/serialize";
import { memberListSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string }> };

/**
 * Workspace members, paginated and searchable.
 *
 * This used to return every member. At a thousand people that is a thousand
 * rows serialised into the page payload on every workspace load, and the
 * member picker then filtered them client-side. Both the list and the picker
 * now ask the server for what they need.
 *
 * Deactivated accounts are excluded by default -- they cannot sign in, so
 * offering them in a DM picker would create a conversation nobody will read.
 */
export const GET = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const url = new URL(req.url);
  const { q, limit, cursor, includeDeactivated } = memberListSchema.parse({
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    includeDeactivated: url.searchParams.get("includeDeactivated") ?? undefined,
  });

  const search = q?.trim();

  const rows = await db.workspaceMember.findMany({
    where: {
      workspaceId,
      ...(includeDeactivated ? {} : { user: { deactivatedAt: null } }),
      ...(search
        ? {
            user: {
              ...(includeDeactivated ? {} : { deactivatedAt: null }),
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { username: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    select: {
      id: true,
      role: true,
      joinedAt: true,
      user: { select: { ...userSelect, email: true, deactivatedAt: true } },
    },
    // Ordered by id, not name: a stable, unique key is what makes the cursor
    // correct. Names are neither.
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return Response.json({
    members: page.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      username: m.user.username,
      image: m.user.image,
      email: m.user.email,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      deactivated: m.user.deactivatedAt !== null,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
});
