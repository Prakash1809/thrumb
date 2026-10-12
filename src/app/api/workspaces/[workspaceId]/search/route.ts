import { Prisma } from "@prisma/client";

import { route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { enforce } from "@/lib/rate-limit";
import { messageInclude, toChannelDTO, toMessageDTO, userSelect } from "@/lib/serialize";
import { searchSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  // The most expensive read we expose: two GIN index scans plus a second
  // fetch. Bounded per user so one client cannot pin a CPU.
  await enforce("search", user.id);

  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const url = new URL(req.url);
  const { q, channelId, limit } = searchSchema.parse({
    q: url.searchParams.get("q") ?? "",
    channelId: url.searchParams.get("channelId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  /**
   * Two matchers, OR'd:
   *  - The stored searchVector handles phrases, stemming and negation
   *    ("deploy -staging"), using the GIN index on that column. Reading the
   *    column rather than recomputing to_tsvector(body) per row is what lets
   *    the planner use the index.
   *  - ILIKE catches prefixes a stemmer will not match ("laten" -> "Latency"),
   *    using the trigram index on body.
   *
   * The join against ChannelMember is the authorization boundary: a message is
   * only reachable through a channel the viewer is actually in, so this cannot
   * surface private channels or other people's DMs. It is a join, not a filter
   * that could be forgotten.
   *
   * `q` is interpolated through Prisma.sql, so it is a bound parameter and not
   * string-concatenated into the statement.
   */
  const hits = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT m."id"
    FROM "Message" m
    JOIN "ChannelMember" cm
      ON cm."channelId" = m."channelId"
     AND cm."userId" = ${user.id}
    WHERE m."workspaceId" = ${workspaceId}
      AND m."deletedAt" IS NULL
      ${channelId ? Prisma.sql`AND m."channelId" = ${channelId}` : Prisma.empty}
      AND (
        m."searchVector" @@ websearch_to_tsquery('english', ${q})
        OR m."body" ILIKE ${`%${q}%`}
      )
    ORDER BY m."createdAt" DESC
    LIMIT ${limit}
  `);

  const ids = hits.map((h) => h.id);
  if (ids.length === 0) return Response.json({ results: [] });

  const rows = await db.message.findMany({
    where: { id: { in: ids } },
    include: {
      ...messageInclude,
      channel: {
        select: {
          id: true,
          workspaceId: true,
          type: true,
          name: true,
          topic: true,
          lastMessageAt: true,
        },
      },
    },
  });

  // Only DM/group rows need their members, and only to build a label. Including
  // members in the query above would pull every member of every public channel
  // a result came from. The upshot is that `isMember` on a named channel in
  // these DTOs is not meaningful -- the search UI uses the label and the id, and
  // the join above already proved the viewer can read every result.
  const dmChannelIds = [
    ...new Set(
      rows.filter((r) => r.channel.type === "DM" || r.channel.type === "GROUP").map((r) => r.channel.id),
    ),
  ];

  const dmMembers = dmChannelIds.length
    ? await db.channelMember.findMany({
        where: { channelId: { in: dmChannelIds } },
        select: { channelId: true, userId: true, lastReadAt: true, user: { select: userSelect } },
      })
    : [];

  const membersByChannel = new Map<string, typeof dmMembers>();
  for (const member of dmMembers) {
    const list = membersByChannel.get(member.channelId);
    if (list) list.push(member);
    else membersByChannel.set(member.channelId, [member]);
  }

  // $queryRaw fixed the ranking; findMany does not preserve `in` order.
  const byId = new Map(rows.map((r) => [r.id, r]));

  return Response.json({
    results: ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const { channel, ...message } = row;
      return [
        {
          message: toMessageDTO(message),
          channel: toChannelDTO(
            { ...channel, members: membersByChannel.get(channel.id) ?? [] },
            user.id,
          ),
        },
      ];
    }),
  });
});
