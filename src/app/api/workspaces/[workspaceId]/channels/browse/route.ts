import { route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { browseChannelsSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string }> };

/**
 * Paginated, searchable list of public channels.
 *
 * The sidebar only ships the first twenty unjoined channels; a workspace with
 * hundreds of them needs a real browser rather than a longer payload. Private
 * channels are excluded entirely -- their existence is not public information,
 * so they must not appear even as a name.
 */
export const GET = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const url = new URL(req.url);
  const { q, limit, cursor } = browseChannelsSchema.parse({
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  const search = q?.trim();

  const rows = await db.channel.findMany({
    where: {
      workspaceId,
      type: "PUBLIC",
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { topic: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      topic: true,
      lastMessageAt: true,
      _count: { select: { members: true } },
      members: { where: { userId: user.id }, select: { id: true } },
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return Response.json({
    channels: page.map((c) => ({
      id: c.id,
      name: c.name,
      topic: c.topic,
      lastMessageAt: c.lastMessageAt.toISOString(),
      memberCount: c._count.members,
      isMember: c.members.length > 0,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
});
