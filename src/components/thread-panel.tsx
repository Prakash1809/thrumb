"use client";

import { useCallback, useEffect, useState } from "react";

import { Composer } from "@/components/composer";
import { CloseIcon } from "@/components/icons";
import { MessageRow } from "@/components/message-row";
import { useSocketEvent } from "@/components/socket-provider";
import { useWorkspace } from "@/components/workspace-provider";
import type { LocalMessage, PendingAttachment } from "@/hooks/use-channel-messages";
import type { MessageDTO, UserSummary } from "@/lib/events";
import { api } from "@/lib/fetcher";
import { isGrouped } from "@/lib/time";

/**
 * The thread side panel. It owns its own replies rather than sharing the
 * channel store, because a thread is loaded whole (replies are bounded) while
 * the channel transcript is paginated -- one list cannot be both.
 */
export function ThreadPanel({
  rootId,
  channelId,
  mentionPeople = [],
  knownUsernames,
  onClose,
}: {
  rootId: string;
  channelId: string;
  mentionPeople?: UserSummary[];
  knownUsernames?: ReadonlySet<string>;
  onClose: () => void;
}) {
  const { viewer, workspace, presence } = useWorkspace();
  const [parent, setParent] = useState<MessageDTO | null>(null);
  const [replies, setReplies] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void api<{ parent: MessageDTO; replies: MessageDTO[] }>(`/api/messages/${rootId}/thread`)
      .then((data) => {
        if (!active) return;
        setParent(data.parent);
        setReplies(data.replies);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load the thread");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [rootId]);

  useSocketEvent("message:new", (message) => {
    if (message.parentId !== rootId) return;
    setReplies((prev) =>
      prev.some((r) => r.id === message.id) ? prev : [...prev, message],
    );
  });

  useSocketEvent("message:update", (message) => {
    if (message.id === rootId) {
      setParent((prev) => (prev ? { ...prev, ...message } : message));
      return;
    }
    if (message.parentId !== rootId) return;
    setReplies((prev) => prev.map((r) => (r.id === message.id ? { ...r, ...message } : r)));
  });

  useSocketEvent("reaction:update", ({ messageId, reactions }) => {
    setParent((prev) => (prev && prev.id === messageId ? { ...prev, reactions } : prev));
    setReplies((prev) => prev.map((r) => (r.id === messageId ? { ...r, reactions } : r)));
  });

  const toggleReaction = useCallback((messageId: string, emoji: string) => {
    void api(`/api/messages/${messageId}/reactions`, { method: "POST", body: { emoji } }).catch(
      () => {},
    );
  }, []);

  const editMessage = useCallback(async (messageId: string, body: string) => {
    await api(`/api/messages/${messageId}`, { method: "PATCH", body: { body } });
  }, []);

  const deleteMessage = useCallback(async (messageId: string) => {
    await api(`/api/messages/${messageId}`, { method: "DELETE" });
  }, []);

  const sendReply = useCallback(
    async ({ body, attachments }: { body: string; attachments: PendingAttachment[] }) => {
      const { message } = await api<{ message: MessageDTO }>(
        `/api/channels/${channelId}/messages`,
        { method: "POST", body: { body, attachments, parentId: rootId } },
      );
      // The broadcast normally lands first; this covers the case where it does not.
      setReplies((prev) => (prev.some((r) => r.id === message.id) ? prev : [...prev, message]));
      return message;
    },
    [channelId, rootId],
  );

  return (
    <aside className="flex w-full min-w-0 flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] lg:w-96">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-line)] px-4">
        <div>
          <h2 className="text-sm font-semibold">Thread</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {replies.length === 0
              ? "No replies yet"
              : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close thread"
          className="focus-ring rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>

      <div className="scroll-y min-h-0 flex-1">
        {loading && (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-10 animate-pulse rounded bg-[var(--color-surface-3)]" />
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="p-4 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {parent && (
          <>
            <MessageRow
              message={parent}
              grouped={false}
              viewerId={viewer.id}
              viewerUsername={viewer.username}
              knownUsernames={knownUsernames}
              online={presence.has(parent.user.id)}
              onToggleReaction={toggleReaction}
              onEdit={editMessage}
              onDelete={deleteMessage}
            />

            {replies.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2">
                <span className="text-xs font-semibold text-[var(--color-ink-muted)]">
                  {replies.length} {replies.length === 1 ? "reply" : "replies"}
                </span>
                <span className="h-px flex-1 bg-[var(--color-line)]" />
              </div>
            )}

            {replies.map((reply, index) => (
              <MessageRow
                key={reply.id}
                message={reply}
                grouped={isGrouped(replies[index - 1], reply)}
                viewerId={viewer.id}
                viewerUsername={viewer.username}
                knownUsernames={knownUsernames}
                online={presence.has(reply.user.id)}
                onToggleReaction={toggleReaction}
                onEdit={editMessage}
                onDelete={deleteMessage}
              />
            ))}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--color-line)] pt-3">
        <Composer
          channelId={channelId}
          resetKey={`thread:${rootId}`}
          workspaceId={workspace.id}
          restoreOnError
          mentionPeople={mentionPeople}
          placeholder="Reply in thread"
          onSend={sendReply}
        />
      </div>
    </aside>
  );
}
