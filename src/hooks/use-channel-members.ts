"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { UserSummary } from "@/lib/events";
import { api } from "@/lib/fetcher";

/**
 * The channel's members, for the @mention picker and for deciding which
 * handles in a message body are real.
 *
 * Capped rather than paginated here: the picker shows eight at a time and the
 * renderer only needs to recognise handles, so loading a thousand members to
 * support either would be waste. Past the cap, an unlisted member's handle
 * still resolves server-side when the message is sent -- it just renders
 * unhighlighted and will not be suggested, which is a far better failure than a
 * slow channel open.
 */
const MEMBER_CAP = 200;

export function useChannelMembers(channelId: string) {
  const [members, setMembers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ members: UserSummary[]; nextCursor: string | null }>(
        `/api/channels/${channelId}/members?limit=${MEMBER_CAP}`,
      );
      setMembers(data.members);
      setTruncated(data.nextCursor !== null);
    } catch {
      // A failed member fetch must not break the channel. Mentions degrade to
      // unhighlighted text and the picker stays empty.
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    let active = true;
    void load().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [load]);

  const knownUsernames = useMemo(
    () => new Set(members.map((m) => m.username.toLowerCase())),
    [members],
  );

  return { members, knownUsernames, loading, truncated, reload: load };
}
