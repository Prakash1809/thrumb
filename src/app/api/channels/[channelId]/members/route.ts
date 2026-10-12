import { badRequest, forbidden, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess } from "@/lib/authz";
import { getChannelDTO } from "@/lib/channels";
import { db } from "@/lib/db";
import { addUsersToChannelRoom, emitToUsers } from "@/lib/realtime";
import { userSelect } from "@/lib/serialize";
import { addChannelMembersSchema } from "@/lib/validation";

type Params = { params: Promise<{ channelId: string }> };

/** Members of a channel, paginated. */
export const GET = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { channelId } = await params;
  await requireChannelAccess(user.id, channelId);

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100);

  const rows = await db.channelMember.findMany({
    where: { channelId },
    select: { id: true, joinedAt: true, user: { select: userSelect } },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return Response.json({
    members: page.map((m) => ({ ...m.user, joinedAt: m.joinedAt.toISOString() })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
});

/**
 * Adds people to a channel.
 *
 * This is what makes private channels usable at all: before it existed, a
 * private channel contained only whoever created it, with no way to let anyone
 * else in.
 *
 * Anyone already in the channel may invite others into it. That matches how
 * teams actually work -- the person who needs a colleague in the conversation
 * is rarely an admin -- and it cannot widen access beyond the workspace,
 * because every candidate is checked for workspace membership first.
 */
export const POST = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { channelId } = await params;
  const { channel } = await requireChannelAccess(user.id, channelId);

  if (channel.type === "DM" || channel.type === "GROUP") {
    // Adding a fourth person to a DM would silently change who can read
    // everything already said in it. Start a new group conversation instead.
    throw badRequest("You cannot add people to a direct message. Start a group message instead.");
  }

  const { userIds } = addChannelMembersSchema.parse(await req.json());

  // Everyone added must already be in the workspace, or a channel invite would
  // become a way to smuggle an outsider past the invite system.
  const eligible = await db.workspaceMember.findMany({
    where: {
      workspaceId: channel.workspaceId,
      userId: { in: userIds },
      user: { deactivatedAt: null },
    },
    select: { userId: true },
  });

  if (eligible.length === 0) {
    throw badRequest("None of those people are members of this workspace");
  }

  const ids = eligible.map((e) => e.userId);

  await db.channelMember.createMany({
    data: ids.map((userId) => ({ channelId, userId })),
    skipDuplicates: true,
  });

  // Put their live sockets in the room and show the channel in their sidebar
  // straight away, rather than on their next reconnect.
  await addUsersToChannelRoom(channelId, ids);
  for (const userId of ids) {
    emitToUsers([userId])("channel:upsert", await getChannelDTO(userId, channelId));
  }

  return Response.json({ added: ids.length, userIds: ids }, { status: 201 });
});
