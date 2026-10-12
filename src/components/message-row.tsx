"use client";

import { useEffect, useRef, useState } from "react";

import { AttachmentList } from "@/components/attachment-list";
import { Avatar } from "@/components/avatar";
import { EmojiPicker } from "@/components/emoji-picker";
import { EmojiIcon, PencilIcon, ThreadIcon, TrashIcon } from "@/components/icons";
import { Linkify } from "@/components/linkify";
import type { LocalMessage } from "@/hooks/use-channel-messages";
import { clockTime, fullTime } from "@/lib/time";

export function MessageRow({
  message,
  grouped,
  viewerId,
  online,
  onToggleReaction,
  onOpenThread,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
}: {
  message: LocalMessage;
  grouped: boolean;
  viewerId: string;
  online?: boolean;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenThread?: (message: LocalMessage) => void;
  onEdit: (messageId: string, body: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onRetry?: (message: LocalMessage) => void;
  onDiscard?: (clientId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const isOwn = message.user.id === viewerId;
  const isDeleted = message.deletedAt !== null;

  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  async function saveEdit() {
    const body = draft.trim();
    if (!body || body === message.body) {
      setEditing(false);
      setDraft(message.body);
      return;
    }
    setBusy(true);
    try {
      await onEdit(message.id, body);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (isDeleted) {
    return (
      <div className="group/row px-4 py-1 pl-[4.25rem] text-sm italic text-[var(--color-ink-muted)]">
        This message was deleted
      </div>
    );
  }

  return (
    <div
      className={`group/row relative px-4 hover:bg-[var(--color-surface-2)] ${grouped ? "py-0.5" : "pt-3 pb-0.5"} ${
        message.pending ? "opacity-60" : ""
      }`}
    >
      <div className="flex gap-3">
        {grouped ? (
          // Timestamp takes the avatar's place on hover, so grouped messages
          // stay scannable without a second column of metadata.
          <span className="w-9 shrink-0 pt-0.5 text-right text-[10px] text-[var(--color-ink-muted)] opacity-0 group-hover/row:opacity-100">
            {clockTime(message.createdAt)}
          </span>
        ) : (
          <Avatar user={message.user} size={36} online={online} />
        )}

        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{message.user.name ?? "Unknown"}</span>
              <time
                dateTime={message.createdAt}
                title={fullTime(message.createdAt)}
                className="text-[11px] text-[var(--color-ink-muted)]"
              >
                {clockTime(message.createdAt)}
              </time>
            </div>
          )}

          {editing ? (
            <div className="mt-1">
              <textarea
                ref={editRef}
                value={draft}
                rows={2}
                className="focus-ring w-full resize-y rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 text-sm"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void saveEdit();
                  }
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(message.body);
                  }
                }}
              />
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  className="focus-ring rounded bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[var(--color-accent-ink)] disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void saveEdit()}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="focus-ring rounded px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)]"
                  onClick={() => {
                    setEditing(false);
                    setDraft(message.body);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {message.body && (
                <p className="message-body text-sm">
                  <Linkify text={message.body} />
                  {message.editedAt && (
                    <span className="ml-1.5 align-baseline text-[11px] text-[var(--color-ink-muted)]">
                      (edited)
                    </span>
                  )}
                </p>
              )}

              <AttachmentList attachments={message.attachments} />

              {message.reactions.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {message.reactions.map((reaction) => {
                    const mine = reaction.userIds.includes(viewerId);
                    return (
                      <li key={reaction.emoji}>
                        <button
                          type="button"
                          aria-pressed={mine}
                          className={`focus-ring flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                            mine
                              ? "border-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)] font-semibold"
                              : "border-[var(--color-line)] bg-[var(--color-surface-2)] hover:border-[var(--color-ink-muted)]"
                          }`}
                          onClick={() => onToggleReaction(message.id, reaction.emoji)}
                        >
                          <span>{reaction.emoji}</span>
                          <span className="tabular-nums">{reaction.count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {message.failed && (
                <p className="mt-1 flex items-center gap-2 text-xs text-[var(--color-danger)]">
                  Not sent.
                  {onRetry && (
                    <button
                      type="button"
                      className="focus-ring font-semibold underline"
                      onClick={() => onRetry(message)}
                    >
                      Retry
                    </button>
                  )}
                  {onDiscard && message.clientId && (
                    <button
                      type="button"
                      className="focus-ring font-semibold underline"
                      onClick={() => onDiscard(message.clientId!)}
                    >
                      Discard
                    </button>
                  )}
                </p>
              )}

              {onOpenThread && message.replyCount > 0 && (
                <button
                  type="button"
                  className="focus-ring mt-1.5 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-semibold text-[var(--color-accent)] hover:underline"
                  onClick={() => onOpenThread(message)}
                >
                  <ThreadIcon className="size-3.5" />
                  {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Hover toolbar. Hidden from the tab order until the row is focused, so
          keyboard users are not walked through four buttons per message. */}
      {!editing && !message.pending && (
        <div className="absolute -top-3 right-4 hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] shadow-sm group-hover/row:flex group-focus-within/row:flex">
          <div className="relative">
            <button
              type="button"
              aria-label="Add reaction"
              title="Add reaction"
              className="focus-ring rounded-md p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
              onClick={() => setPickerOpen((open) => !open)}
            >
              <EmojiIcon />
            </button>
            {pickerOpen && (
              <EmojiPicker
                onClose={() => setPickerOpen(false)}
                onPick={(emoji) => onToggleReaction(message.id, emoji)}
              />
            )}
          </div>

          {onOpenThread && (
            <button
              type="button"
              aria-label="Reply in thread"
              title="Reply in thread"
              className="focus-ring rounded-md p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
              onClick={() => onOpenThread(message)}
            >
              <ThreadIcon />
            </button>
          )}

          {isOwn && (
            <>
              <button
                type="button"
                aria-label="Edit message"
                title="Edit message"
                className="focus-ring rounded-md p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                onClick={() => {
                  setDraft(message.body);
                  setEditing(true);
                }}
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                aria-label="Delete message"
                title="Delete message"
                className="focus-ring rounded-md p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
                onClick={() => {
                  if (confirm("Delete this message? This cannot be undone.")) {
                    void onDelete(message.id);
                  }
                }}
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
