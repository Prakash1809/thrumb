import type { NotificationLevel } from "@prisma/client";

import type { ChannelDTO } from "@/lib/events";
import { db } from "@/lib/db";
import { toChannelDTO, userSelect } from "@/lib/serialize";
import { unreadSummary } from "@/lib/unread";

export type ChannelLists = {
  /** Named channels the viewer has joined, plus every DM/group they are in. */
  joined: ChannelDTO[];
  /**
   * Public channels the viewer has not joined. Capped -- a workspace with a
   * thousand channels must not ship all of them on every page load. The full
   * set is paginated and searchable through /channels/browse.
   */
  available: ChannelDTO[];
  /** True when `available` was truncated, so the UI can point at Browse. */
  hasMoreAvailable: boolean;
};

const AVAILABLE_PREVIEW = 20;

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
  const [joinedNamed, availableNamed, dms, unread, prefs] = await Promise.all([
    db.channel.findMany({
      where: {
        workspaceId,
        type: { in: ["PUBLIC", "PRIVATE"] },
        members: { some: { userId } },
      },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        name: true,
        topic: true,
        lastMessageAt: true,
        members: {
          where: { userId },
          select: { userId: true, lastReadAt: true, user: { select: userSelect } },
        },
      },
      orderBy: { name: "asc" },
    }),

    // Browseable public channels, capped. `+1` so we can tell whether there
    // are more without a second count query.
    db.channel.findMany({
      where: { workspaceId, type: "PUBLIC", members: { none: { userId } } },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        name: true,
        topic: true,
        lastMessageAt: true,
      },
      orderBy: { name: "asc" },
      take: AVAILABLE_PREVIEW + 1,
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
      take: 100,
    }),

    unreadSummary(userId, workspaceId),
    db.notificationPref.findMany({
      where: { userId, workspaceId },
      select: { channelId: true, level: true },
    }),
  ]);

  const channelPref = new Map<string, NotificationLevel>();
  let workspaceDefault: NotificationLevel = "MENTIONS";
  for (const pref of prefs) {
    if (pref.channelId) channelPref.set(pref.channelId, pref.level);
    else workspaceDefault = pref.level;
  }

  const notifyFor = (channelId: string): NotificationLevel =>
    channelPref.get(channelId) ?? workspaceDefault;

  const joined: ChannelDTO[] = [
    ...joinedNamed.map((row) =>
      toChannelDTO(row, userId, {
        unreadCount: unread.counts.get(row.id) ?? 0,
        unreadMentions: unread.mentions.get(row.id) ?? 0,
        notify: notifyFor(row.id),
      }),
    ),
    ...dms.map((row) =>
      toChannelDTO(row, userId, {
        unreadCount: unread.counts.get(row.id) ?? 0,
        unreadMentions: unread.mentions.get(row.id) ?? 0,
        notify: notifyFor(row.id),
      }),
    ),
  ];

  const hasMoreAvailable = availableNamed.length > AVAILABLE_PREVIEW;
  const available = (hasMoreAvailable ? availableNamed.slice(0, AVAILABLE_PREVIEW) : availableNamed).map(
    (row) =>
      toChannelDTO({ ...row, members: [] }, userId, {
        unreadCount: 0,
        unreadMentions: 0,
        notify: notifyFor(row.id),
      }),
  );

  return { joined, available, hasMoreAvailable };
}

/** A single channel shaped for the client, with the viewer's badge counts. */
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

  const [members, unread, prefs] = await Promise.all([
    // A DM needs every participant to build its label. A named channel only
    // needs to know whether the viewer is in it -- loading all 1,000 members of
    // #general to answer that would be wasteful.
    db.channelMember.findMany({
      where: isDm ? { channelId } : { channelId, userId },
      select: { userId: true, lastReadAt: true, user: { select: userSelect } },
      take: isDm ? 50 : 1,
    }),
    unreadSummary(userId, channel.workspaceId),
    db.notificationPref.findMany({
      where: { userId, workspaceId: channel.workspaceId, OR: [{ channelId }, { channelId: null }] },
      select: { channelId: true, level: true },
    }),
  ]);

  const notify =
    prefs.find((p) => p.channelId === channelId)?.level ??
    prefs.find((p) => p.channelId === null)?.level ??
    "MENTIONS";

  return toChannelDTO({ ...channel, members }, userId, {
    unreadCount: unread.counts.get(channelId) ?? 0,
    unreadMentions: unread.mentions.get(channelId) ?? 0,
    notify,
  });
}
