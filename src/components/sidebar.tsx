"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { ChevronIcon, HashIcon, LockIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { useWorkspace } from "@/components/workspace-provider";
import type { ChannelDTO } from "@/lib/events";
import { channelLabel } from "@/lib/channel-label";
import { api } from "@/lib/fetcher";

function ChannelRow({
  channel,
  href,
  active,
  onNavigate,
}: {
  channel: ChannelDTO;
  href: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { presence } = useWorkspace();
  const isNamed = channel.type === "PUBLIC" || channel.type === "PRIVATE";
  const label = channelLabel(channel);
  const unread = channel.unreadCount;
  const mentions = channel.unreadMentions;
  const muted = channel.notify === "NONE";
  const counterpart = channel.counterparts[0];

  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`focus-ring flex items-center gap-2 rounded-md px-2 py-1 text-sm transition ${
          active
            ? "bg-[var(--color-rail-active)] font-semibold text-white"
            : mentions > 0 || (unread > 0 && !muted)
              ? "font-semibold text-white hover:bg-[var(--color-rail-hover)]"
              : "text-[var(--color-rail-text)] hover:bg-[var(--color-rail-hover)]"
        }`}
      >
        {channel.type === "PRIVATE" ? (
          <LockIcon className="size-3.5 opacity-70" />
        ) : isNamed ? (
          <HashIcon className="size-3.5 opacity-70" />
        ) : counterpart ? (
          <Avatar user={counterpart} size={18} online={presence.has(counterpart.id)} />
        ) : (
          <span className="size-3.5" />
        )}

        <span className="min-w-0 flex-1 truncate">{label}</span>

        {/* A mention badge outranks an unread count: "someone needs you" is a
            different message from "there is traffic here". */}
        {mentions > 0 ? (
          <span
            title={`${mentions} mention${mentions === 1 ? "" : "s"}`}
            className="rounded-full bg-[var(--color-danger)] px-1.5 text-[11px] font-bold tabular-nums text-white"
          >
            @{mentions > 99 ? "99+" : mentions}
          </span>
        ) : (
          unread > 0 &&
          !active && (
            <span
              className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                muted
                  ? "bg-white/15 text-[var(--color-rail-muted)]"
                  : "bg-[var(--color-danger)] text-white"
              }`}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )
        )}
      </Link>
    </li>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-4">
      <div className="mb-0.5 flex items-center gap-1 px-2">
        <button
          type="button"
          aria-expanded={open}
          className="focus-ring flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-[var(--color-rail-muted)] hover:text-white"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronIcon className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
          {title}
        </button>
        <span className="ml-auto">{action}</span>
      </div>
      {open && <ul className="grid gap-px px-2">{children}</ul>}
    </div>
  );
}

export function Sidebar({
  onOpenSearch,
  onNewChannel,
  onNewDm,
  onInvite,
  onOpenMembers,
  onNavigate,
}: {
  onOpenSearch: () => void;
  onNewChannel: () => void;
  onNewDm: () => void;
  onInvite: () => void;
  onOpenMembers: () => void;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const {
    workspace,
    viewer,
    joined,
    available,
    activeChannelId,
    refreshChannels,
    presence,
    canInvite,
    hasMoreAvailable,
  } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);

  const named = joined.filter((c) => c.type === "PUBLIC" || c.type === "PRIVATE");
  const dms = joined.filter((c) => c.type === "DM" || c.type === "GROUP");

  const addButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="focus-ring rounded p-0.5 text-[var(--color-rail-muted)] hover:bg-[var(--color-rail-hover)] hover:text-white"
      onClick={onClick}
    >
      <PlusIcon className="size-3.5" />
    </button>
  );

  return (
    <nav className="flex h-full w-64 shrink-0 flex-col bg-[var(--color-rail)] text-[var(--color-rail-text)]">
      <div className="relative shrink-0 border-b border-white/10 px-3 py-3">
        <button
          type="button"
          aria-expanded={menuOpen}
          className="focus-ring flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-[var(--color-rail-hover)]"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-white">{workspace.name}</span>
            <span className="block truncate text-xs text-[var(--color-rail-muted)]">
              {viewer.name ?? "You"}
            </span>
          </span>
          <Avatar user={viewer} size={28} online={presence.has(viewer.id)} />
        </button>

        {menuOpen && (
          <div
            className="absolute inset-x-3 top-full z-40 mt-1 overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] py-1 text-[var(--color-ink)] shadow-xl"
            onMouseLeave={() => setMenuOpen(false)}
          >
            {canInvite && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm font-medium hover:bg-[var(--color-surface-2)]"
                onClick={() => {
                  setMenuOpen(false);
                  onInvite();
                }}
              >
                Invite people
              </button>
            )}
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)]"
              onClick={() => {
                setMenuOpen(false);
                onOpenMembers();
              }}
            >
              People
            </button>
            <Link
              href="/w"
              className="block px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
              onClick={() => setMenuOpen(false)}
            >
              Switch workspace
            </Link>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)]"
              onClick={() => {
                setMenuOpen(false);
                void refreshChannels();
              }}
            >
              Refresh channels
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
              onClick={() => void signOut({ callbackUrl: "/login" })}
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-2">
        <button
          type="button"
          className="focus-ring flex w-full items-center gap-2 rounded-md bg-white/10 px-2.5 py-1.5 text-left text-sm text-[var(--color-rail-text)] hover:bg-white/15"
          onClick={onOpenSearch}
        >
          <SearchIcon className="size-3.5" />
          <span className="flex-1">Search</span>
          <kbd className="rounded border border-white/20 px-1 text-[10px] font-sans">Ctrl K</kbd>
        </button>
      </div>

      <div className="scroll-y min-h-0 flex-1 py-2">
        <Section title="Channels" action={addButton("Create a channel", onNewChannel)}>
          {named.length === 0 && (
            <li className="px-2 py-1 text-xs text-[var(--color-rail-muted)]">
              No channels yet.
            </li>
          )}
          {named.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              href={`/w/${workspace.id}/c/${channel.id}`}
              active={channel.id === activeChannelId}
              onNavigate={onNavigate}
            />
          ))}
        </Section>

        <Section title="Direct messages" action={addButton("New message", onNewDm)}>
          {dms.length === 0 && (
            <li className="px-2 py-1 text-xs text-[var(--color-rail-muted)]">
              No conversations yet.
            </li>
          )}
          {dms.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              href={`/w/${workspace.id}/c/${channel.id}`}
              active={channel.id === activeChannelId}
              onNavigate={onNavigate}
            />
          ))}
        </Section>

        {available.length > 0 && (
          <div className="mb-4 px-2">
            <button
              type="button"
              aria-expanded={browseOpen}
              className="focus-ring flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-[var(--color-rail-muted)] hover:text-white"
              onClick={() => setBrowseOpen((v) => !v)}
            >
              <ChevronIcon
                className={`size-3 transition-transform ${browseOpen ? "rotate-90" : ""}`}
              />
              Browse {available.length}{hasMoreAvailable ? "+" : ""} more
            </button>

            {browseOpen && (
              <ul className="mt-0.5 grid gap-px">
                {available.map((channel) => (
                  <li key={channel.id}>
                    <button
                      type="button"
                      className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-[var(--color-rail-muted)] hover:bg-[var(--color-rail-hover)] hover:text-white"
                      onClick={async () => {
                        // Opening a public channel joins it, which is what the
                        // messages endpoint does server-side anyway.
                        onNavigate?.();
                        router.push(`/w/${workspace.id}/c/${channel.id}`);
                        await api(`/api/channels/${channel.id}/read`, { method: "POST" }).catch(
                          () => {},
                        );
                        await refreshChannels();
                      }}
                    >
                      <HashIcon className="size-3.5 opacity-60" />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {channel.name ?? "channel"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
