"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSocket, useSocketEvent } from "@/components/socket-provider";
import type { AttachmentDTO, MessageDTO, UserSummary } from "@/lib/events";
import { api } from "@/lib/fetcher";

export type LocalMessage = MessageDTO & {
  /** Still in flight. Rendered dimmed. */
  pending?: boolean;
  /** The POST failed. Rendered with a retry affordance. */
  failed?: boolean;
};

export type PendingAttachment = {
  key: string;
  name: string;
  mimeType: string;
  size: number;
};

type SendInput = { body: string; attachments: PendingAttachment[]; parentId?: string | null };

function sortByTime(list: LocalMessage[]): LocalMessage[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * The transcript for one channel: initial page, older pages, live updates, and
 * optimistic sends.
 *
 * Sends render immediately from a temporary row carrying a clientId. The server
 * echoes that clientId on the broadcast, which is how the real message replaces
 * the placeholder instead of appearing next to it -- the thing that makes a
 * chat feel instant rather than merely fast.
 */
export function useChannelMessages(
  channelId: string,
  workspaceId: string,
  viewer: UserSummary,
) {
  const { socket } = useSocket();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow first page for channel A landing after the user has
  // already switched to channel B.
  const requestedChannel = useRef(channelId);

  useEffect(() => {
    requestedChannel.current = channelId;
    setMessages([]);
    setCursor(null);
    setLoading(true);
    setError(null);

    void api<{ messages: MessageDTO[]; nextCursor: string | null }>(
      `/api/channels/${channelId}/messages`,
    )
      .then((data) => {
        if (requestedChannel.current !== channelId) return;
        setMessages(data.messages);
        setCursor(data.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestedChannel.current !== channelId) return;
        setError(err instanceof Error ? err.message : "Could not load messages");
        setLoading(false);
      });
  }, [channelId]);

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api<{ messages: MessageDTO[]; nextCursor: string | null }>(
        `/api/channels/${channelId}/messages?cursor=${encodeURIComponent(cursor)}`,
      );
      if (requestedChannel.current !== channelId) return;
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...data.messages.filter((m) => !known.has(m.id)), ...prev];
      });
      setCursor(data.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [channelId, cursor, loadingMore]);

  const upsert = useCallback((incoming: LocalMessage) => {
    setMessages((prev) => {
      // Reconcile an optimistic row first, then fall back to id, so neither
      // path can produce a duplicate.
      const byClientId = incoming.clientId
        ? prev.findIndex((m) => m.clientId === incoming.clientId)
        : -1;
      const index = byClientId !== -1 ? byClientId : prev.findIndex((m) => m.id === incoming.id);

      if (index === -1) return sortByTime([...prev, incoming]);

      const next = [...prev];
      next[index] = incoming;
      return next;
    });
  }, []);

  useSocketEvent("message:new", (message) => {
    if (message.channelId !== channelId) return;
    // Thread replies belong to the thread panel, not the channel transcript.
    if (message.parentId) return;
    upsert(message);
  });

  useSocketEvent("message:update", (message) => {
    if (message.channelId !== channelId || message.parentId) return;
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
  });

  useSocketEvent("reaction:update", ({ messageId, channelId: incomingChannel, reactions }) => {
    if (incomingChannel !== channelId) return;
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
  });

  const send = useCallback(
    async ({ body, attachments, parentId = null }: SendInput) => {
      const clientId = crypto.randomUUID();
      const now = new Date().toISOString();

      const optimisticAttachments: AttachmentDTO[] = attachments.map((a, index) => ({
        id: `${clientId}-${index}`,
        key: a.key,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
        width: null,
        height: null,
        url: `/api/files/${a.key.split("/").map(encodeURIComponent).join("/")}`,
      }));

      if (!parentId) {
        upsert({
          id: `pending-${clientId}`,
          channelId,
          workspaceId,
          parentId: null,
          body,
          createdAt: now,
          editedAt: null,
          deletedAt: null,
          replyCount: 0,
          lastReplyAt: null,
          user: viewer,
          attachments: optimisticAttachments,
          reactions: [],
          clientId,
          pending: true,
        } satisfies LocalMessage);
      }

      socket?.emit("typing:stop", channelId);

      try {
        const { message } = await api<{ message: MessageDTO }>(
          `/api/channels/${channelId}/messages`,
          { method: "POST", body: { body, attachments, parentId, clientId } },
        );
        // The broadcast usually wins the race, in which case this is a no-op.
        if (!parentId) upsert({ ...message, clientId });
        return message;
      } catch (err) {
        if (!parentId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.clientId === clientId ? { ...m, pending: false, failed: true } : m,
            ),
          );
        }
        throw err;
      }
    },
    [channelId, socket, upsert, viewer, workspaceId],
  );

  /** Drops a failed optimistic row, for the "discard" action. */
  const discard = useCallback((clientId: string) => {
    setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
  }, []);

  return {
    messages,
    loading,
    loadingMore,
    hasOlder: cursor !== null,
    error,
    loadOlder,
    send,
    discard,
  };
}
