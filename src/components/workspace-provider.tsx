"use client";

import { useParams } from "next/navigation";
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
import type { ChannelDTO, UserSummary } from "@/lib/events";
import { TYPING_TTL_MS } from "@/lib/events";
import { useSocket, useSocketEvent } from "@/components/socket-provider";

export type WorkspaceSummary = { id: string; name: string; slug: string };
export type WorkspaceMemberSummary = UserSummary & { role: "OWNER" | "ADMIN" | "MEMBER" };

type TypingEntry = { userId: string; name: string | null; expiresAt: number };

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

type WorkspaceContextValue = {
  workspace: WorkspaceSummary;
  viewer: UserSummary;
  /** The viewer's role here. Gates the invite action; the API re-checks it. */
  viewerRole: WorkspaceRole;
  canInvite: boolean;
  joined: ChannelDTO[];
  available: ChannelDTO[];
  members: WorkspaceMemberSummary[];
  presence: ReadonlySet<string>;
  activeChannelId: string | null;
  connected: boolean;
  typingIn: (channelId: string) => TypingEntry[];
  markRead: (channelId: string) => void;
  noteIncoming: (channelId: string, authorId: string, at: string) => void;
  refreshChannels: () => Promise<void>;
  openDm: (userIds: string[]) => Promise<ChannelDTO>;
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
  viewerRole,
  initialJoined,
  initialAvailable,
  initialMembers,
  children,
}: {
  workspace: WorkspaceSummary;
  viewer: UserSummary;
  viewerRole: WorkspaceRole;
  initialJoined: ChannelDTO[];
  initialAvailable: ChannelDTO[];
  initialMembers: WorkspaceMemberSummary[];
  children: React.ReactNode;
}) {
  const params = useParams<{ channelId?: string }>();
  const activeChannelId = params?.channelId ?? null;
  const { socket, connected } = useSocket();

  const [joined, setJoined] = useState(() => sortChannels(initialJoined));
  const [available, setAvailable] = useState(initialAvailable);
  const [members, setMembers] = useState(initialMembers);
  const [presence, setPresence] = useState<ReadonlySet<string>>(() => new Set([viewer.id]));
  const [typing, setTyping] = useState<Record<string, TypingEntry[]>>({});

  // The socket handler for message:new needs the channel the user is looking at
  // right now, not the one captured when the listener was bound.
  const activeRef = useRef(activeChannelId);
  activeRef.current = activeChannelId;

  const refreshChannels = useCallback(async () => {
    const data = await api<{ joined: ChannelDTO[]; available: ChannelDTO[] }>(
      `/api/workspaces/${workspace.id}/channels`,
    );
    setJoined(sortChannels(data.joined));
    setAvailable(data.available);
  }, [workspace.id]);

  const markRead = useCallback(
    (channelId: string) => {
      setJoined((prev) =>
        prev.map((c) => (c.id === channelId && c.unreadCount ? { ...c, unreadCount: 0 } : c)),
      );
      // Fire and forget: the badge is already gone locally, and a failure just
      // means it comes back on next load.
      void api(`/api/channels/${channelId}/read`, { method: "POST" }).catch(() => {});
    },
    [],
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
      setJoined((prev) =>
        sortChannels([...prev.filter((c) => c.id !== channel.id), channel]),
      );
      setAvailable((prev) => prev.filter((c) => c.id !== channel.id));
      socket?.emit("channel:subscribe", channel.id);
    } else {
      setAvailable((prev) => [...prev.filter((c) => c.id !== channel.id), channel]);
    }
  });

  useSocketEvent("channel:removed", ({ channelId }) => {
    setJoined((prev) => prev.filter((c) => c.id !== channelId));
    setAvailable((prev) => prev.filter((c) => c.id !== channelId));
  });

  useSocketEvent("read:update", ({ channelId }) => {
    setJoined((prev) => prev.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)));
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

  useEffect(() => {
    void api<{ members: WorkspaceMemberSummary[] }>(`/api/workspaces/${workspace.id}/members`)
      .then((data) => setMembers(data.members))
      .catch(() => {});
  }, [workspace.id]);

  const typingIn = useCallback(
    (channelId: string) => typing[channelId] ?? [],
    [typing],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspace,
      viewer,
      viewerRole,
      // Hiding the control is a convenience, not the control: POST
      // /api/workspaces/[id]/invites calls requireWorkspaceAdmin regardless.
      canInvite: viewerRole !== "MEMBER",
      joined,
      available,
      members,
      presence,
      activeChannelId,
      connected,
      typingIn,
      markRead,
      noteIncoming,
      refreshChannels,
      openDm,
    }),
    [
      workspace,
      viewer,
      viewerRole,
      joined,
      available,
      members,
      presence,
      activeChannelId,
      connected,
      typingIn,
      markRead,
      noteIncoming,
      refreshChannels,
      openDm,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return value;
}
