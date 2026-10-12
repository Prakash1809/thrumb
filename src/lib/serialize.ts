import { Prisma } from "@prisma/client";

import type {
  AttachmentDTO,
  ChannelDTO,
  MessageDTO,
  NotificationLevel,
  ReactionGroup,
  UserSummary,
} from "@/lib/events";

export const userSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
} satisfies Prisma.UserSelect;

export const messageInclude = {
  user: { select: userSelect },
  attachments: true,
  reactions: { select: { emoji: true, userId: true } },
} satisfies Prisma.MessageInclude;

export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function attachmentUrl(key: string): string {
  // The key holds `/`-separated path segments; encode each one so a filename
  // with spaces or `#` still resolves.
  return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function toAttachmentDTO(row: {
  id: string;
  key: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}): AttachmentDTO {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    url: attachmentUrl(row.key),
  };
}

export function groupReactions(rows: { emoji: string; userId: string }[]): ReactionGroup[] {
  const byEmoji = new Map<string, string[]>();
  for (const { emoji, userId } of rows) {
    const list = byEmoji.get(emoji);
    if (list) list.push(userId);
    else byEmoji.set(emoji, [userId]);
  }
  return [...byEmoji.entries()]
    .map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export function toMessageDTO(row: MessageRow, clientId?: string): MessageDTO {
  return {
    id: row.id,
    channelId: row.channelId,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    // A soft-deleted message keeps its row so thread ordering and reply counts
    // stay stable; the body is withheld from the wire entirely.
    body: row.deletedAt ? "" : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    replyCount: row.replyCount,
    lastReplyAt: row.lastReplyAt?.toISOString() ?? null,
    user: row.user,
    attachments: row.deletedAt ? [] : row.attachments.map(toAttachmentDTO),
    reactions: row.deletedAt ? [] : groupReactions(row.reactions),
    ...(clientId ? { clientId } : {}),
  };
}

export type ChannelRow = {
  id: string;
  workspaceId: string;
  type: "PUBLIC" | "PRIVATE" | "DM" | "GROUP";
  name: string | null;
  topic: string | null;
  lastMessageAt: Date;
  members: { userId: string; lastReadAt: Date; user: UserSummary }[];
};

export type ChannelBadges = {
  unreadCount?: number;
  unreadMentions?: number;
  notify?: NotificationLevel;
};

export function toChannelDTO(
  row: ChannelRow,
  viewerId: string,
  badges: ChannelBadges = {},
): ChannelDTO {
  const membership = row.members.find((m) => m.userId === viewerId);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type,
    name: row.name,
    topic: row.topic,
    lastMessageAt: row.lastMessageAt.toISOString(),
    counterparts:
      row.type === "DM" || row.type === "GROUP"
        ? row.members.filter((m) => m.userId !== viewerId).map((m) => m.user)
        : [],
    unreadCount: badges.unreadCount ?? 0,
    unreadMentions: badges.unreadMentions ?? 0,
    notify: badges.notify ?? "MENTIONS",
    isMember: Boolean(membership),
  };
}

// channelLabel lives in lib/channel-label.ts: client components need it, and
// this module imports @prisma/client.
