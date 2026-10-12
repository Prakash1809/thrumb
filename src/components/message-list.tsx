"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { MessageRow } from "@/components/message-row";
import { DownIcon } from "@/components/icons";
import type { LocalMessage } from "@/hooks/use-channel-messages";
import { dayKey, dayLabel, isGrouped } from "@/lib/time";

const NEAR_BOTTOM_PX = 80;
const LOAD_OLDER_AT_PX = 250;

export function MessageList({
  messages,
  viewerId,
  presence,
  hasOlder,
  loadingMore,
  loading,
  emptyState,
  onLoadOlder,
  onToggleReaction,
  onOpenThread,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
  onReachBottom,
}: {
  messages: LocalMessage[];
  viewerId: string;
  presence: ReadonlySet<string>;
  hasOlder: boolean;
  loadingMore: boolean;
  loading: boolean;
  emptyState: React.ReactNode;
  onLoadOlder: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenThread?: (message: LocalMessage) => void;
  onEdit: (messageId: string, body: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onRetry?: (message: LocalMessage) => void;
  onDiscard?: (clientId: string) => void;
  onReachBottom?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Whether the reader was pinned to the bottom *before* this render, which is
  // what decides if a new message should scroll into view or quietly sit below.
  const wasAtBottom = useRef(true);
  // Scroll height captured before prepending older messages, so the viewport
  // can be restored and the reader does not get yanked upward.
  const restoreFrom = useRef<number | null>(null);
  const lastCount = useRef(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = distance <= NEAR_BOTTOM_PX;
    wasAtBottom.current = bottom;
    setAtBottom(bottom);
    if (bottom) onReachBottom?.();

    if (el.scrollTop < LOAD_OLDER_AT_PX && hasOlder && !loadingMore) {
      restoreFrom.current = el.scrollHeight;
      onLoadOlder();
    }
  }, [hasOlder, loadingMore, onLoadOlder, onReachBottom]);

  // Layout effect, not effect: the scroll correction has to happen in the same
  // frame as the DOM change or the list visibly jumps.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (restoreFrom.current !== null) {
      el.scrollTop += el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
      lastCount.current = messages.length;
      return;
    }

    const grew = messages.length > lastCount.current;
    lastCount.current = messages.length;

    if (grew && wasAtBottom.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  // Landing in a channel always starts at the newest message.
  useEffect(() => {
    if (loading) return;
    wasAtBottom.current = true;
    scrollToBottom();
    onReachBottom?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  if (loading) {
    return (
      <div className="flex-1 space-y-4 p-6">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex animate-pulse gap-3">
            <div className="size-9 rounded-md bg-[var(--color-surface-3)]" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3 w-32 rounded bg-[var(--color-surface-3)]" />
              <div className="h-3 w-2/3 rounded bg-[var(--color-surface-3)]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={handleScroll} className="scroll-y h-full pb-2">
        {hasOlder && (
          <div className="py-3 text-center text-xs text-[var(--color-ink-muted)]">
            {loadingMore ? "Loading earlier messages..." : "Scroll up for earlier messages"}
          </div>
        )}

        {messages.length === 0 && !hasOlder && emptyState}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);

          return (
            <div key={message.id}>
              {newDay && (
                <div className="sticky top-0 z-10 flex items-center gap-3 bg-[var(--color-surface)] px-4 py-2">
                  <span className="h-px flex-1 bg-[var(--color-line)]" />
                  <span className="rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-ink-muted)]">
                    {dayLabel(message.createdAt)}
                  </span>
                  <span className="h-px flex-1 bg-[var(--color-line)]" />
                </div>
              )}

              <MessageRow
                message={message}
                grouped={!newDay && isGrouped(previous, message)}
                viewerId={viewerId}
                online={presence.has(message.user.id)}
                onToggleReaction={onToggleReaction}
                onOpenThread={onOpenThread}
                onEdit={onEdit}
                onDelete={onDelete}
                onRetry={onRetry}
                onDiscard={onDiscard}
              />
            </div>
          );
        })}
      </div>

      {!atBottom && (
        <button
          type="button"
          className="focus-ring fade-in absolute right-5 bottom-4 flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold shadow-md"
          onClick={() => scrollToBottom("smooth")}
        >
          <DownIcon className="size-3.5" />
          Jump to latest
        </button>
      )}
    </div>
  );
}
