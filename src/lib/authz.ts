import type { ChannelType, Role } from "@prisma/client";

import { forbidden, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { addUsersToChannelRoom } from "@/lib/realtime";
import { userSelect } from "@/lib/serialize";

/** Throws unless the user belongs to the workspace. */
export async function requireWorkspaceMember(userId: string, workspaceId: string) {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { workspace: true },
  });
  if (!membership) throw notFound("Workspace not found");
  return membership;
}

export async function requireWorkspaceAdmin(userId: string, workspaceId: string) {
  const membership = await requireWorkspaceMember(userId, workspaceId);
  if (membership.role === "MEMBER") throw forbidden("Only admins can do this");
  return membership;
}

export type ChannelAccess = {
  channel: {
    id: string;
    workspaceId: string;
    type: ChannelType;
    name: string | null;
    topic: string | null;
    lastMessageAt: Date;
    createdById: string | null;
  };
  role: Role;
  /** True when this call auto-joined the viewer, so callers can announce it. */
  joined: boolean;
};

/**
 * Resolves a channel the user is allowed to read.
 *
 * Public channels auto-join on first read, matching Slack: browsing a public
 * channel makes you a member so unread counts and realtime delivery start
 * working without a separate "join" step. Private channels, DMs and group DMs
 * require an existing membership row.
 */
export async function requireChannelAccess(userId: string, channelId: string): Promise<ChannelAccess> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      workspaceId: true,
      type: true,
      name: true,
      topic: true,
      lastMessageAt: true,
      createdById: true,
      members: { where: { userId }, select: { id: true } },
    },
  });
  if (!channel) throw notFound("Channel not found");

  const membership = await requireWorkspaceMember(userId, channel.workspaceId);
  const { members, ...rest } = channel;

  if (members.length > 0) return { channel: rest, role: membership.role, joined: false };

  if (channel.type !== "PUBLIC") throw forbidden("You are not a member of this channel");

  await db.channelMember.create({ data: { channelId, userId } });

  // Sockets join their channel rooms at connect time, so a channel joined
  // mid-session has to be pushed into the room now -- otherwise this user would
  // read the first page and then see nothing live until they reconnect.
  await addUsersToChannelRoom(channelId, [userId]);

  return { channel: rest, role: membership.role, joined: true };
}

/** Member ids of a channel — the broadcast audience for sidebar-level events. */
export async function channelMemberIds(channelId: string): Promise<string[]> {
  const rows = await db.channelMember.findMany({
    where: { channelId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Full channel row shaped for toChannelDTO. */
export function channelWithMembers(channelId: string) {
  return db.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: {
      id: true,
      workspaceId: true,
      type: true,
      name: true,
      topic: true,
      lastMessageAt: true,
      members: {
        select: { userId: true, lastReadAt: true, user: { select: userSelect } },
      },
    },
  });
}
