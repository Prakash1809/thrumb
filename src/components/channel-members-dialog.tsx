"use client";

import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/avatar";
import { inputClass, primaryButtonClass } from "@/components/auth-shell";
import { Modal } from "@/components/modal";
import { useWorkspace, type WorkspaceMemberSummary } from "@/components/workspace-provider";
import { channelLabel } from "@/lib/channel-label";
import type { ChannelDTO, UserSummary } from "@/lib/events";
import { api } from "@/lib/fetcher";

const DEBOUNCE_MS = 200;

/**
 * Channel membership.
 *
 * This is what makes private channels usable: before it existed, a private
 * channel contained only whoever created it, with no way to let anyone in.
 */
export function ChannelMembersDialog({
  channel,
  canManage,
  onChanged,
  onClose,
}: {
  channel: ChannelDTO;
  /** Workspace admins can remove people; the channel's creator can too (checked server-side). */
  canManage: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { presence, viewer, searchMembers } = useWorkspace();

  const [members, setMembers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<WorkspaceMemberSummary[]>([]);
  const [selected, setSelected] = useState<WorkspaceMemberSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ members: UserSummary[] }>(
        `/api/channels/${channel.id}/members?limit=100`,
      );
      setMembers(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load members");
    } finally {
      setLoading(false);
    }
  }, [channel.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  // Candidate search is debounced and server-side, like the DM picker.
  useEffect(() => {
    if (!query.trim()) {
      setCandidates([]);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      void searchMembers(query)
        .then((rows) => {
          if (!active) return;
          const present = new Set(members.map((m) => m.id));
          setCandidates(rows.filter((r) => !present.has(r.id)));
        })
        .catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [members, query, searchMembers]);

  async function add() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/channels/${channel.id}/members`, {
        method: "POST",
        body: { userIds: selected.map((m) => m.id) },
      });
      setSelected([]);
      setQuery("");
      await loadMembers();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add those people");
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setError(null);
    try {
      await api(`/api/channels/${channel.id}/members/${userId}`, { method: "DELETE" });
      await loadMembers();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that person");
    }
  }

  const isDirect = channel.type === "DM" || channel.type === "GROUP";
  const label = channelLabel(channel);

  return (
    <Modal
      title={isDirect ? `People in ${label}` : `People in #${label}`}
      description={
        isDirect
          ? "Membership of a direct message is fixed. Start a group message to include more people."
          : channel.type === "PRIVATE"
            ? "Only these people can see this channel."
            : "Anyone in the workspace can join this channel."
      }
      onClose={onClose}
      wide
    >
      {!isDirect && (
        <section className="mb-5">
          <input
            value={query}
            placeholder="Add someone by name or @handle"
            className={inputClass}
            onChange={(e) => setQuery(e.target.value)}
          />

          {selected.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {selected.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    className="focus-ring flex items-center gap-1.5 rounded-full bg-[var(--color-surface-3)] py-0.5 pr-2 pl-1 text-xs font-medium"
                    onClick={() =>
                      setSelected((prev) => prev.filter((m) => m.id !== member.id))
                    }
                  >
                    <Avatar user={member} size={18} />
                    {member.name ?? member.username}
                    <span aria-hidden className="text-[var(--color-ink-muted)]">
                      ×
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {candidates.length > 0 && (
            <ul className="scroll-y mt-2 max-h-40 rounded-md border border-[var(--color-line)]">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-2)]"
                    onClick={() => {
                      setSelected((prev) =>
                        prev.some((m) => m.id === candidate.id) ? prev : [...prev, candidate],
                      );
                      setQuery("");
                    }}
                  >
                    <Avatar user={candidate} size={24} />
                    <span className="min-w-0 flex-1 truncate">
                      {candidate.name ?? candidate.username}
                    </span>
                    <span className="truncate text-xs text-[var(--color-ink-muted)]">
                      @{candidate.username}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected.length > 0 && (
            <button
              type="button"
              className={`${primaryButtonClass} mt-3`}
              disabled={busy}
              onClick={() => void add()}
            >
              {busy ? "Adding…" : `Add ${selected.length === 1 ? "1 person" : `${selected.length} people`}`}
            </button>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <ul className="scroll-y max-h-72 divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)]">
        {loading && (
          <li className="px-3 py-6 text-center text-sm text-[var(--color-ink-muted)]">Loading…</li>
        )}

        {!loading &&
          members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar user={member} size={28} online={presence.has(member.id)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {member.name ?? member.username}
                  {member.id === viewer.id && (
                    <span className="ml-1.5 text-xs font-normal text-[var(--color-ink-muted)]">
                      you
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                  @{member.username}
                </span>
              </span>

              {canManage && !isDirect && member.id !== viewer.id && (
                <button
                  type="button"
                  className="focus-ring rounded px-2 py-1 text-xs font-semibold text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
                  onClick={() => void remove(member.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
      </ul>
    </Modal>
  );
}
