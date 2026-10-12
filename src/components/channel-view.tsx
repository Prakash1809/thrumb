"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import { Composer } from "@/components/composer";
import { HashIcon, LockIcon, MoreIcon, ThreadIcon } from "@/components/icons";
import { MessageList } from "@/components/message-list";
import { ThreadPanel } from "@/components/thread-panel";
import { useWorkspace } from "@/components/workspace-provider";
import { useChannelMessages, type LocalMessage, type PendingAttachment } from "@/hooks/use-channel-messages";
import type { ChannelDTO } from "@/lib/events";
import { ChannelMembersDialog } from "@/components/channel-members-dialog";
import { useChannelMembers } from "@/hooks/use-channel-members";
import { channelLabel } from "@/lib/channel-label";
import { api } from "@/lib/fetcher";

const READ_DEBOUNCE_MS = 700;

const NOTIFY_OPTIONS = [
  { level: "ALL" as const, label: "Every message" },
  { level: "MENTIONS" as const, label: "Mentions only" },
  { level: "NONE" as const, label: "Nothing" },
];

export function ChannelView({ channel }: { channel: ChannelDTO }) {
  const router = useRouter();
  const {
    viewer,
    workspace,
    presence,
    markRead,
    markMentionsRead,
    noteIncoming,
    typingIn,
    connected,
    refreshChannels,
    setNotificationLevel,
    canAdminister,
  } = useWorkspace();
  const { messages, loading, loadingMore, hasOlder, error, loadOlder, send, discard } =
    useChannelMessages(channel.id, workspace.id, viewer);
  const {
    members,
    knownUsernames,
    truncated: truncatedMembers,
    reload: reloadMembers,
  } = useChannelMembers(channel.id);

  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  const label = channelLabel(channel);
  const isNamed = channel.type === "PUBLIC" || channel.type === "PRIVATE";
  const typing = typingIn(channel.id);

  // Closing the thread when the channel changes stops a panel from a previous
  // conversation hanging around over a different transcript.
  useEffect(() => {
    setThreadRootId(null);
    setMenuOpen(false);
    setMembersOpen(false);
  }, [channel.id]);

  /**
   * Opening a channel clears its mention badge.
   *
   * Mentions are a to-do list, not a counter, so they are cleared by being
   * looked at rather than by scrolling to the bottom like ordinary unreads --
   * the thing that named you is somewhere in the transcript, and you came here
   * to read it.
   */
  useEffect(() => {
    if (channel.unreadMentions > 0) markMentionsRead(channel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const leaveChannel = useCallback(async () => {
    setMenuOpen(false);
    try {
      await api(`/api/channels/${channel.id}/membership`, { method: "DELETE" });
      await refreshChannels();
      router.push(`/w/${workspace.id}`);
    } catch {
      // The sidebar still shows the channel, which is the honest state.
    }
  }, [channel.id, refreshChannels, router, workspace.id]);

  // The sidebar needs to know about traffic here even while this pane owns the
  // messages, so recency and unread stay correct across channels.
  const latestId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest || latest.pending) return;
    noteIncoming(channel.id, latest.user.id, latest.createdAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId, channel.id]);

  // Debounced, because reaching the bottom fires on every scroll frame and this
  // is a write.
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReachBottom = useCallback(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => markRead(channel.id), READ_DEBOUNCE_MS);
  }, [channel.id, markRead]);

  useEffect(
    () => () => {
      if (readTimer.current) clearTimeout(readTimer.current);
    },
    [],
  );

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

  const onSend = useCallback(
    (input: { body: string; attachments: PendingAttachment[] }) => send(input),
    [send],
  );

  const retry = useCallback(
    (message: LocalMessage) => {
      if (message.clientId) discard(message.clientId);
      void send({
        body: message.body,
        attachments: message.attachments.map((a) => ({
          key: a.key,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
        })),
      }).catch(() => {});
    },
    [discard, send],
  );

  const headerIcon = useMemo(() => {
    if (channel.type === "PRIVATE") return <LockIcon className="text-[var(--color-ink-muted)]" />;
    if (isNamed) return <HashIcon className="text-[var(--color-ink-muted)]" />;
    const first = channel.counterparts[0];
    return first ? <Avatar user={first} size={22} online={presence.has(first.id)} /> : null;
  }, [channel.counterparts, channel.type, isNamed, presence]);

  const emptyState = (
    <div className="px-6 py-10">
      <h2 className="text-xl font-semibold tracking-tight">
        {isNamed ? `This is the start of #${label}` : `This is your conversation with ${label}`}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {isNamed
          ? channel.topic || "Send the first message to get things going."
          : "Messages here are only visible to the two of you."}
      </p>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-[var(--color-surface)]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-line)] px-4">
          <div className="flex min-w-0 items-center gap-2">
            {headerIcon}
            <h1 className="truncate text-base font-semibold tracking-tight">
              {isNamed ? `#${label}` : label}
            </h1>
          </div>

          {channel.topic && (
            <>
              <span className="h-4 w-px bg-[var(--color-line)]" />
              <p className="truncate text-xs text-[var(--color-ink-muted)]">{channel.topic}</p>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {!connected && (
              <span className="rounded-full bg-[var(--color-surface-3)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)]">
                Reconnecting...
              </span>
            )}
            {threadRootId && (
              <button
                type="button"
                className="focus-ring hidden items-center gap-1.5 rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs font-medium lg:flex"
                onClick={() => setThreadRootId(null)}
              >
                <ThreadIcon className="size-3.5" />
                Hide thread
              </button>
            )}

            {isNamed && (
              <div className="relative">
                <button
                  type="button"
                  aria-label="Channel options"
                  aria-expanded={menuOpen}
                  className="focus-ring rounded-md p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <MoreIcon />
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-xl"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)]"
                      onClick={() => {
                        setMenuOpen(false);
                        setMembersOpen(true);
                      }}
                    >
                      Members{truncatedMembers ? "" : ` (${members.length})`}
                    </button>

                    <div className="my-1 h-px bg-[var(--color-line)]" />

                    <p className="px-3 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                      Notify me about
                    </p>
                    {NOTIFY_OPTIONS.map((option) => (
                      <button
                        key={option.level}
                        type="button"
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)] ${
                          channel.notify === option.level ? "font-semibold" : ""
                        }`}
                        onClick={() => {
                          setMenuOpen(false);
                          void setNotificationLevel(channel.id, option.level).catch(() => {});
                        }}
                      >
                        {option.label}
                        {channel.notify === option.level && <span aria-hidden>✓</span>}
                      </button>
                    ))}

                    <div className="my-1 h-px bg-[var(--color-line)]" />

                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
                      onClick={() => void leaveChannel()}
                    >
                      Leave #{label}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {error ? (
          <div className="flex-1 p-6">
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          </div>
        ) : (
          <MessageList
            messages={messages}
            viewerId={viewer.id}
            viewerUsername={viewer.username}
            knownUsernames={knownUsernames}
            presence={presence}
            hasOlder={hasOlder}
            loadingMore={loadingMore}
            loading={loading}
            emptyState={emptyState}
            onLoadOlder={loadOlder}
            onToggleReaction={toggleReaction}
            onOpenThread={(message) => setThreadRootId(message.id)}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onRetry={retry}
            onDiscard={discard}
            onReachBottom={onReachBottom}
          />
        )}

        {/* Reserved height so the composer does not shift when someone starts
            typing -- a jumping input is worse than a blank line. */}
        <p
          aria-live="polite"
          className="h-5 shrink-0 truncate px-5 text-xs text-[var(--color-ink-muted)]"
        >
          {typing.length === 1
            ? `${typing[0].name ?? "Someone"} is typing...`
            : typing.length === 2
              ? `${typing[0].name ?? "Someone"} and ${typing[1].name ?? "someone"} are typing...`
              : typing.length > 2
                ? "Several people are typing..."
                : ""}
        </p>

        <div className="shrink-0">
          <Composer
            channelId={channel.id}
            workspaceId={workspace.id}
            autoFocus
            mentionPeople={members}
            placeholder={isNamed ? `Message #${label}` : `Message ${label}`}
            onSend={onSend}
          />
        </div>
      </section>

      {threadRootId && (
        <div className="fixed inset-0 z-30 bg-[var(--color-surface)] lg:static lg:z-auto lg:flex">
          <ThreadPanel
            rootId={threadRootId}
            channelId={channel.id}
            mentionPeople={members}
            knownUsernames={knownUsernames}
            onClose={() => setThreadRootId(null)}
          />
        </div>
      )}

      {membersOpen && (
        <ChannelMembersDialog
          channel={channel}
          canManage={canAdminister}
          onChanged={reloadMembers}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </div>
  );
}
