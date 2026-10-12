/**
 * The realtime contract. Imported by both the Socket.IO server (server.ts) and
 * the browser client, so a renamed event breaks the build rather than the app.
 */

export type UserSummary = {
  id: string;
  name: string | null;
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
  isMember: boolean;
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
