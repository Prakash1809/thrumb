import type { ChannelDTO } from "@/lib/events";
import { db } from "@/lib/db";
import { toChannelDTO, userSelect } from "@/lib/serialize";
import { unreadCounts } from "@/lib/unread";

export type ChannelLists = {
  /** Named channels the viewer has joined, plus every DM/group they are in. */
  joined: ChannelDTO[];
  /** Public channels in the workspace the viewer has not joined yet. */
  available: ChannelDTO[];
};

/**
 * One source of truth for the sidebar, used by both the server-rendered layout
 * and the channels API so the two can never disagree.
 *
 * Named channels and DMs are fetched separately: a DM's label comes from its
 * members, while loading every member of a large public channel just to decide
 * whether the viewer is in it would be wasteful.
 */
export async function listChannelsForUser(
  userId: string,
  workspaceId: string,
): Promise<ChannelLists> {
  const [named, dms, unread] = await Promise.all([
    db.channel.findMany({
      where: {
        workspaceId,
        OR: [{ type: "PUBLIC" }, { type: "PRIVATE", members: { some: { userId } } }],
      },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        name: true,
        topic: true,
        lastMessageAt: true,
        members: { where: { userId }, select: { userId: true, lastReadAt: true, user: { select: userSelect } } },
      },
      orderBy: { name: "asc" },
    }),
    db.channel.findMany({
      where: { workspaceId, type: { in: ["DM", "GROUP"] }, members: { some: { userId } } },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        name: true,
        topic: true,
        lastMessageAt: true,
        members: { select: { userId: true, lastReadAt: true, user: { select: userSelect } } },
      },
      orderBy: { lastMessageAt: "desc" },
    }),
    unreadCounts(userId, workspaceId),
  ]);

  const joined: ChannelDTO[] = [];
  const available: ChannelDTO[] = [];

  for (const row of named) {
    const dto = toChannelDTO(row, userId, unread.get(row.id) ?? 0);
    (dto.isMember ? joined : available).push(dto);
  }

  for (const row of dms) {
    joined.push(toChannelDTO(row, userId, unread.get(row.id) ?? 0));
  }

  return { joined, available };
}

/** A single channel shaped for the client, with the viewer's unread count. */
export async function getChannelDTO(userId: string, channelId: string): Promise<ChannelDTO> {
  const channel = await db.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: {
      id: true,
      workspaceId: true,
      type: true,
      name: true,
      topic: true,
      lastMessageAt: true,
    },
  });

  const isDm = channel.type === "DM" || channel.type === "GROUP";

  const [members, unread] = await Promise.all([
    // A DM needs every participant to build its label. A named channel only
    // needs to know whether the viewer is in it -- loading all 1,000 members of
    // #general to answer that would be wasteful.
    db.channelMember.findMany({
      where: isDm ? { channelId } : { channelId, userId },
      select: { userId: true, lastReadAt: true, user: { select: userSelect } },
    }),
    unreadCounts(userId, channel.workspaceId),
  ]);

  return toChannelDTO({ ...channel, members }, userId, unread.get(channelId) ?? 0);
}
