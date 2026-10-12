"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CloseIcon, PaperclipIcon, SendIcon } from "@/components/icons";
import { useSocket } from "@/components/socket-provider";
import type { PendingAttachment } from "@/hooks/use-channel-messages";
import { uploadFiles } from "@/lib/fetcher";
import { formatBytes } from "@/lib/format";

const TYPING_THROTTLE_MS = 2500;
const MAX_ROWS_PX = 180;

export function Composer({
  channelId,
  workspaceId,
  placeholder,
  autoFocus = false,
  resetKey,
  restoreOnError = false,
  onSend,
}: {
  /** Real channel id. Typing events are scoped to this, so it must be joinable. */
  channelId: string;
  workspaceId: string;
  placeholder: string;
  autoFocus?: boolean;
  /**
   * Identity of the *draft*, which is not always the channel: a thread has its
   * own composer in the same channel, and switching threads should clear it.
   * Defaults to the channel id.
   */
  resetKey?: string;
  /**
   * Put the draft back if the send fails. Channel sends leave an optimistic row
   * with its own Retry, so restoring there would show the text twice; thread
   * replies have no such row, so without this the text would be lost.
   */
  restoreOnError?: boolean;
  onSend: (input: { body: string; attachments: PendingAttachment[] }) => Promise<unknown>;
}) {
  const { socket } = useSocket();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastTypingAt = useRef(0);
  const draftKey = resetKey ?? channelId;

  // Switching channels or threads should not carry a half-written message across.
  useEffect(() => {
    setValue("");
    setAttachments([]);
    setError(null);
  }, [draftKey]);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, []);

  useEffect(resize, [value, resize]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus, draftKey]);

  // Throttled, so a fast typist sends one event every 2.5s instead of one per
  // keystroke. The server-side TTL expires the indicator if they stop.
  const noteTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingAt.current < TYPING_THROTTLE_MS) return;
    lastTypingAt.current = now;
    socket?.emit("typing:start", channelId);
  }, [channelId, socket]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        const saved = await uploadFiles(workspaceId, files);
        setAttachments((prev) => [...prev, ...saved].slice(0, 10));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [workspaceId],
  );

  const submit = useCallback(async () => {
    const body = value.trim();
    if ((!body && attachments.length === 0) || sending || uploading) return;

    setSending(true);
    setError(null);

    // Clear before awaiting: the optimistic row is already on screen, and
    // holding the text until the round trip finishes is the lag people notice.
    const sent = { body: value, attachments };
    setValue("");
    setAttachments([]);

    try {
      await onSend({ body, attachments });
      socket?.emit("typing:stop", channelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send");
      if (restoreOnError) {
        setValue(sent.body);
        setAttachments(sent.attachments);
      }
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [attachments, channelId, onSend, restoreOnError, sending, socket, uploading, value]);

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !uploading && !sending;

  return (
    <div className="px-4 pb-4">
      <div
        className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] focus-within:border-[var(--color-ink-muted)]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-b border-[var(--color-line)] p-2">
            {attachments.map((attachment) => (
              <li
                key={attachment.key}
                className="flex items-center gap-2 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs"
              >
                <span className="max-w-40 truncate font-medium">{attachment.name}</span>
                <span className="text-[var(--color-ink-muted)]">{formatBytes(attachment.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  className="focus-ring rounded p-0.5 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((a) => a.key !== attachment.key))
                  }
                >
                  <CloseIcon className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-[var(--color-ink-muted)]"
          onChange={(e) => {
            setValue(e.target.value);
            noteTyping();
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline. Standard chat behaviour,
            // and the composer grows rather than scrolling a fixed box.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length > 0) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onBlur={() => socket?.emit("typing:stop", channelId)}
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach files"
              title="Attach files"
              className="focus-ring rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
              onClick={() => fileRef.current?.click()}
            >
              <PaperclipIcon />
            </button>
            {uploading && (
              <span className="text-xs text-[var(--color-ink-muted)]">Uploading...</span>
            )}
          </div>

          <button
            type="button"
            aria-label="Send message"
            className="focus-ring rounded-md bg-[var(--color-accent)] p-1.5 text-[var(--color-accent-ink)] transition disabled:bg-[var(--color-surface-3)] disabled:text-[var(--color-ink-muted)]"
            disabled={!canSend}
            onClick={() => void submit()}
          >
            <SendIcon />
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-1.5 px-1 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 px-1 text-xs text-[var(--color-ink-muted)]">
          <kbd className="font-sans font-semibold">Shift</kbd> +{" "}
          <kbd className="font-sans font-semibold">Enter</kbd> for a new line
        </p>
      )}
    </div>
  );
}
