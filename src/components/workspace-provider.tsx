"use client";

import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "@/lib/fetcher";
import type { ChannelDTO, NotificationLevel, UserSummary } from "@/lib/events";
import { TYPING_TTL_MS } from "@/lib/events";
import { useSocket, useSocketEvent } from "@/components/socket-provider";

export type WorkspaceSummary = { id: string; name: string; slug: string };
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export type WorkspaceMemberSummary = UserSummary & {
  role: WorkspaceRole;
  email?: string | null;
  deactivated?: boolean;
};

type TypingEntry = { userId: string; name: string | null; expiresAt: number };

type WorkspaceContextValue = {
  workspace: WorkspaceSummary;
  viewer: UserSummary;
  viewerRole: WorkspaceRole;
  canInvite: boolean;
  canAdminister: boolean;
  joined: ChannelDTO[];
  available: ChannelDTO[];
  hasMoreAvailable: boolean;
  presence: ReadonlySet<string>;
  activeChannelId: string | null;
  connected: boolean;
  totalUnreadMentions: number;
  typingIn: (channelId: string) => TypingEntry[];
  markRead: (channelId: string) => void;
  markMentionsRead: (channelId: string) => void;
  noteIncoming: (channelId: string, authorId: string, at: string) => void;
  refreshChannels: () => Promise<void>;
  openDm: (userIds: string[]) => Promise<ChannelDTO>;
  /** Server-side member search. Not a filter over a preloaded list. */
  searchMembers: (query: string) => Promise<WorkspaceMemberSummary[]>;
  setNotificationLevel: (channelId: string | null, level: NotificationLevel) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function sortChannels(list: ChannelDTO[]): ChannelDTO[] {
  return [...list].sort((a, b) => {
    const named = a.type === "PUBLIC" || a.type === "PRIVATE";
    const otherNamed = b.type === "PUBLIC" || b.type === "PRIVATE";
    // Named channels keep a stable alphabetical order; DMs float by recency,
    // which is how people actually look for them.
    if (named && otherNamed) return (a.name ?? "").localeCompare(b.name ?? "");
    if (named !== otherNamed) return named ? -1 : 1;
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
}

export function WorkspaceProvider({
  workspace,
  viewer,
  viewerRole: initialRole,
  initialJoined,
  initialAvailable,
  initialHasMoreAvailable,
  children,
}: {
  workspace: WorkspaceSummary;
  viewer: UserSummary;
  viewerRole: WorkspaceRole;
  initialJoined: ChannelDTO[];
  initialAvailable: ChannelDTO[];
  initialHasMoreAvailable: boolean;
  children: React.ReactNode;
}) {
  const params = useParams<{ channelId?: string }>();
  const router = useRouter();
  const activeChannelId = params?.channelId ?? null;
  const { socket, connected } = useSocket();

  const [joined, setJoined] = useState(() => sortChannels(initialJoined));
  const [available, setAvailable] = useState(initialAvailable);
  const [hasMoreAvailable, setHasMoreAvailable] = useState(initialHasMoreAvailable);
  const [viewerRole, setViewerRole] = useState(initialRole);
  const [presence, setPresence] = useState<ReadonlySet<string>>(() => new Set([viewer.id]));
  const [typing, setTyping] = useState<Record<string, TypingEntry[]>>({});

  // The socket handler for message:new needs the channel the user is looking at
  // right now, not the one captured when the listener was bound.
  const activeRef = useRef(activeChannelId);
  activeRef.current = activeChannelId;

  const refreshChannels = useCallback(async () => {
    const data = await api<{
      joined: ChannelDTO[];
      available: ChannelDTO[];
      hasMoreAvailable: boolean;
    }>(`/api/workspaces/${workspace.id}/channels`);
    setJoined(sortChannels(data.joined));
    setAvailable(data.available);
    setHasMoreAvailable(data.hasMoreAvailable);
  }, [workspace.id]);

  const markRead = useCallback((channelId: string) => {
    setJoined((prev) =>
      prev.map((c) => (c.id === channelId && c.unreadCount ? { ...c, unreadCount: 0 } : c)),
    );
    // Fire and forget: the badge is already gone locally, and a failure just
    // means it comes back on next load.
    void api(`/api/channels/${channelId}/read`, { method: "POST" }).catch(() => {});
  }, []);

  const markMentionsRead = useCallback(
    (channelId: string) => {
      setJoined((prev) =>
        prev.map((c) => (c.id === channelId && c.unreadMentions ? { ...c, unreadMentions: 0 } : c)),
      );
      void api(`/api/workspaces/${workspace.id}/mentions`, {
        method: "POST",
        body: { channelId },
      }).catch(() => {});
    },
    [workspace.id],
  );

  /** Bumps recency, and unread when the channel is not the one on screen. */
  const noteIncoming = useCallback(
    (channelId: string, authorId: string, at: string) => {
      setJoined((prev) => {
        const index = prev.findIndex((c) => c.id === channelId);
        if (index === -1) return prev;
        const channel = prev[index];
        const isActive = activeRef.current === channelId;
        const next = [...prev];
        next[index] = {
          ...channel,
          lastMessageAt: at,
          unreadCount:
            isActive || authorId === viewer.id ? channel.unreadCount : channel.unreadCount + 1,
        };
        return sortChannels(next);
      });
    },
    [viewer.id],
  );

  const openDm = useCallback(
    async (userIds: string[]) => {
      const { channel } = await api<{ channel: ChannelDTO }>(
        `/api/workspaces/${workspace.id}/dm`,
        { method: "POST", body: { userIds } },
      );
      setJoined((prev) =>
        sortChannels(prev.some((c) => c.id === channel.id) ? prev : [...prev, channel]),
      );
      socket?.emit("channel:subscribe", channel.id);
      return channel;
    },
    [socket, workspace.id],
  );

  /**
   * Member lookup goes to the server.
   *
   * The previous version loaded every member into context on mount and
   * filtered client-side, which is a thousand-row payload on every page load in
   * a large workspace -- and the picker still only ever showed eight of them.
   */
  const searchMembers = useCallback(
    async (query: string) => {
      const params = new URLSearchParams({ limit: "25" });
      if (query.trim()) params.set("q", query.trim());

      const data = await api<{ members: WorkspaceMemberSummary[] }>(
        `/api/workspaces/${workspace.id}/members?${params.toString()}`,
      );
      return data.members;
    },
    [workspace.id],
  );

  const setNotificationLevel = useCallback(
    async (channelId: string | null, level: NotificationLevel) => {
      // Optimistic: the switch should move under the finger, not after a round
      // trip. A failure is corrected by the next channel refresh.
      if (channelId) {
        setJoined((prev) => prev.map((c) => (c.id === channelId ? { ...c, notify: level } : c)));
      }

      await api(`/api/workspaces/${workspace.id}/notifications`, {
        method: "PUT",
        body: { channelId, level },
      });

      if (!channelId) await refreshChannels();
    },
    [refreshChannels, workspace.id],
  );

  useSocketEvent("presence:sync", (ids) => {
    setPresence(new Set([viewer.id, ...ids]));
  });

  useSocketEvent("presence:update", ({ userId, online }) => {
    setPresence((prev) => {
      const next = new Set(prev);
      if (online) next.add(userId);
      else next.delete(userId);
      return next;
    });
  });

  useSocketEvent("channel:upsert", (channel) => {
    if (channel.workspaceId !== workspace.id) return;

    if (channel.isMember) {
      setJoined((prev) => sortChannels([...prev.filter((c) => c.id !== channel.id), channel]));
      setAvailable((prev) => prev.filter((c) => c.id !== channel.id));
      socket?.emit("channel:subscribe", channel.id);
    } else {
      setAvailable((prev) => [...prev.filter((c) => c.id !== channel.id), channel]);
    }
  });

  useSocketEvent("channel:removed", ({ channelId }) => {
    setJoined((prev) => prev.filter((c) => c.id !== channelId));
    setAvailable((prev) => prev.filter((c) => c.id !== channelId));

    // If they were looking at it when access was revoked, get them out of it
    // rather than leaving a pane that will 404 on its next fetch.
    if (activeRef.current === channelId) router.push(`/w/${workspace.id}`);
  });

  useSocketEvent("read:update", ({ channelId }) => {
    setJoined((prev) => prev.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)));
  });

  useSocketEvent("mentions:update", ({ channelId, unreadMentions }) => {
    setJoined((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, unreadMentions } : c)),
    );
  });

  useSocketEvent("membership:update", ({ workspaceId, role }) => {
    if (workspaceId !== workspace.id) return;

    // Removed from the workspace entirely: there is nothing left to render.
    if (role === null) {
      router.push("/w");
      return;
    }

    setViewerRole(role);
  });

  useSocketEvent("typing", ({ channelId, userId, name }) => {
    if (userId === viewer.id) return;
    setTyping((prev) => {
      const entries = (prev[channelId] ?? []).filter((e) => e.userId !== userId);
      entries.push({ userId, name, expiresAt: Date.now() + TYPING_TTL_MS });
      return { ...prev, [channelId]: entries };
    });
  });

  useSocketEvent("typing:stop", ({ channelId, userId }) => {
    setTyping((prev) => {
      const entries = (prev[channelId] ?? []).filter((e) => e.userId !== userId);
      if (entries.length === 0) {
        const { [channelId]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [channelId]: entries };
    });
  });

  // Typing indicators expire on their own. The interval only runs while
  // someone is actually typing, so an idle tab does no work.
  const hasTyping = Object.keys(typing).length > 0;
  useEffect(() => {
    if (!hasTyping) return;
    const id = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        let changed = false;
        const next: Record<string, TypingEntry[]> = {};
        for (const [channelId, entries] of Object.entries(prev)) {
          const live = entries.filter((e) => e.expiresAt > now);
          if (live.length !== entries.length) changed = true;
          if (live.length > 0) next[channelId] = live;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [hasTyping]);

  // A reconnect may have missed events while the socket was down, so resync the
  // sidebar rather than trusting stale counts.
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) void refreshChannels();
    wasConnected.current = connected;
  }, [connected, refreshChannels]);

  const typingIn = useCallback((channelId: string) => typing[channelId] ?? [], [typing]);

  const totalUnreadMentions = useMemo(
    () => joined.reduce((sum, c) => sum + c.unreadMentions, 0),
    [joined],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspace,
      viewer,
      viewerRole,
      // Hiding a control is a convenience, not the control: every one of these
      // endpoints re-checks the role server-side.
      canInvite: viewerRole !== "MEMBER",
      canAdminister: viewerRole !== "MEMBER",
      joined,
      available,
      hasMoreAvailable,
      presence,
      activeChannelId,
      connected,
      totalUnreadMentions,
      typingIn,
      markRead,
      markMentionsRead,
      noteIncoming,
      refreshChannels,
      openDm,
      searchMembers,
      setNotificationLevel,
    }),
    [
      workspace,
      viewer,
      viewerRole,
      joined,
      available,
      hasMoreAvailable,
      presence,
      activeChannelId,
      connected,
      totalUnreadMentions,
      typingIn,
      markRead,
      markMentionsRead,
      noteIncoming,
      refreshChannels,
      openDm,
      searchMembers,
      setNotificationLevel,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return value;
}
