"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/avatar";
import { inputClass, primaryButtonClass } from "@/components/auth-shell";
import { Modal } from "@/components/modal";
import { useWorkspace, type WorkspaceMemberSummary } from "@/components/workspace-provider";

const DEBOUNCE_MS = 200;

export function NewDmDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { workspace, viewer, presence, openDm, searchMembers } = useWorkspace();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceMemberSummary[]>([]);
  const [selected, setSelected] = useState<WorkspaceMemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Candidates come from the server, debounced.
   *
   * Filtering a preloaded list is simpler, but it means shipping every member
   * of the workspace to every client -- which stops being viable somewhere
   * around a few hundred people.
   */
  useEffect(() => {
    let active = true;
    setLoading(true);

    const timer = setTimeout(() => {
      void searchMembers(query)
        .then((members) => {
          if (!active) return;
          setResults(members.filter((m) => m.id !== viewer.id));
          setError(null);
        })
        .catch((err: unknown) => {
          if (!active) return;
          setError(err instanceof Error ? err.message : "Could not load people");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, searchMembers, viewer.id]);

  const selectedIds = new Set(selected.map((m) => m.id));

  function toggle(member: WorkspaceMemberSummary) {
    setSelected((prev) =>
      prev.some((m) => m.id === member.id)
        ? prev.filter((m) => m.id !== member.id)
        : [...prev, member],
    );
  }

  async function start() {
    if (selected.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const channel = await openDm(selected.map((m) => m.id));
      onClose();
      router.push(`/w/${workspace.id}/c/${channel.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the conversation");
      setPending(false);
    }
  }

  return (
    <Modal
      title="New message"
      description="Pick one person for a DM, or several for a group."
      onClose={onClose}
    >
      <div className="grid gap-3">
        <input
          value={query}
          placeholder="Search by name or @handle"
          className={inputClass}
          onChange={(e) => setQuery(e.target.value)}
        />

        {/* Selections survive a changed search term, so building a group does
            not mean holding every name in your head at once. */}
        {selected.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {selected.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  className="focus-ring flex items-center gap-1.5 rounded-full bg-[var(--color-surface-3)] py-0.5 pr-2 pl-1 text-xs font-medium"
                  onClick={() => toggle(member)}
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

        <ul className="scroll-y max-h-72 rounded-md border border-[var(--color-line)]">
          {loading && (
            <li className="px-3 py-6 text-center text-sm text-[var(--color-ink-muted)]">
              Searching…
            </li>
          )}

          {!loading && results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-[var(--color-ink-muted)]">
              {query.trim() ? "Nobody matches that." : "No one else is in this workspace yet."}
            </li>
          )}

          {!loading &&
            results.map((member) => {
              const checked = selectedIds.has(member.id);
              return (
                <li key={member.id} className="border-b border-[var(--color-line)] last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--color-surface-2)]">
                    <input type="checkbox" checked={checked} onChange={() => toggle(member)} />
                    <Avatar user={member} size={28} online={presence.has(member.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {member.name ?? member.username}
                      </span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                        @{member.username}
                      </span>
                    </span>
                    {member.role !== "MEMBER" && (
                      <span className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-ink-muted)]">
                        {member.role}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
        </ul>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <button
          type="button"
          className={primaryButtonClass}
          disabled={pending || selected.length === 0}
          onClick={() => void start()}
        >
          {pending
            ? "Opening..."
            : selected.length > 1
              ? `Start group with ${selected.length} people`
              : "Start conversation"}
        </button>
      </div>
    </Modal>
  );
}
