/**
 * The realtime contract. Imported by both the Socket.IO server (server.ts) and
 * the browser client, so a renamed event breaks the build rather than the app.
 */

export type UserSummary = {
  id: string;
  name: string | null;
  /** Handle used by @mentions. Unique instance-wide. */
  username: string;
  image: string | null;
};

export type AttachmentDTO = {
  id: string;
  key: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
};

export type ReactionGroup = {
  emoji: string;
  count: number;
  userIds: string[];
};

export type MessageDTO = {
  id: string;
  channelId: string;
  workspaceId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  user: UserSummary;
  attachments: AttachmentDTO[];
  reactions: ReactionGroup[];
  /** Echo of the sender's optimistic row id, so it reconciles instead of duplicating. */
  clientId?: string;
  /** Present on thread replies: who else is in the thread, for the parent's avatar strip. */
  threadParticipants?: UserSummary[];
};

export type ChannelDTO = {
  id: string;
  workspaceId: string;
  type: "PUBLIC" | "PRIVATE" | "DM" | "GROUP";
  name: string | null;
  topic: string | null;
  lastMessageAt: string;
  /** For DM/GROUP rows: the members other than the viewer, used for the label. */
  counterparts: UserSummary[];
  unreadCount: number;
  /** Unread messages that named the viewer. Badged separately and louder. */
  unreadMentions: number;
  isMember: boolean;
  /** The viewer's notification choice for this channel. */
  notify: NotificationLevel;
};

export type NotificationLevel = "ALL" | "MENTIONS" | "NONE";

/**
 * A notification the client should surface (desktop notification, title badge).
 *
 * Sent only to users the server decided should be notified, so the client does
 * not re-implement the preference and mention rules -- and so a muted channel
 * costs the client nothing at all.
 */
export type NotifyPayload = {
  messageId: string;
  channelId: string;
  workspaceId: string;
  /** Channel name, or the sender's name for a DM. */
  channelLabel: string;
  isDirect: boolean;
  /** True when this fired because the viewer was named. */
  isMention: boolean;
  author: UserSummary;
  preview: string;
};

export type TypingPayload = {
  channelId: string;
  userId: string;
  name: string | null;
};

export type ServerToClientEvents = {
  "message:new": (message: MessageDTO) => void;
  "message:update": (message: MessageDTO) => void;
  "message:delete": (payload: { id: string; channelId: string; parentId: string | null }) => void;
  "reaction:update": (payload: {
    messageId: string;
    channelId: string;
    parentId: string | null;
    reactions: ReactionGroup[];
  }) => void;
  "channel:upsert": (channel: ChannelDTO) => void;
  "channel:removed": (payload: { channelId: string }) => void;
  typing: (payload: TypingPayload) => void;
  "typing:stop": (payload: TypingPayload) => void;
  "presence:sync": (onlineUserIds: string[]) => void;
  "presence:update": (payload: { userId: string; online: boolean }) => void;
  "read:update": (payload: { channelId: string; lastReadAt: string }) => void;
  /** Surface a desktop notification / title badge. */
  notify: (payload: NotifyPayload) => void;
  /** The viewer's unread mention count for a channel changed. */
  "mentions:update": (payload: { channelId: string; unreadMentions: number }) => void;
  /** An admin changed the viewer's role, or removed them from the workspace. */
  "membership:update": (payload: {
    workspaceId: string;
    role: "OWNER" | "ADMIN" | "MEMBER" | null;
  }) => void;
};

export type ClientToServerEvents = {
  "channel:subscribe": (channelId: string) => void;
  "channel:unsubscribe": (channelId: string) => void;
  "typing:start": (channelId: string) => void;
  "typing:stop": (channelId: string) => void;
};

export const roomFor = {
  user: (userId: string) => `u:${userId}`,
  workspace: (workspaceId: string) => `ws:${workspaceId}`,
  channel: (channelId: string) => `ch:${channelId}`,
};

/** How long a `typing` event stays live before the UI drops it. */
export const TYPING_TTL_MS = 4000;
