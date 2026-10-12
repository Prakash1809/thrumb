"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Avatar } from "@/components/avatar";
import { inputClass, primaryButtonClass } from "@/components/auth-shell";
import { Modal } from "@/components/modal";
import { useWorkspace } from "@/components/workspace-provider";

export function NewDmDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { workspace, members, viewer, presence, openDm } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members
      .filter((m) => m.id !== viewer.id)
      .filter((m) => !needle || (m.name ?? "").toLowerCase().includes(needle));
  }, [members, query, viewer.id]);

  async function start() {
    if (selected.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const channel = await openDm(selected);
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
          placeholder="Search people"
          className={inputClass}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ul className="scroll-y max-h-72 rounded-md border border-[var(--color-line)]">
          {candidates.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-[var(--color-ink-muted)]">
              No one else is in this workspace yet.
            </li>
          )}

          {candidates.map((member) => {
            const checked = selected.includes(member.id);
            return (
              <li key={member.id} className="border-b border-[var(--color-line)] last:border-b-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--color-surface-2)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelected((prev) =>
                        checked ? prev.filter((id) => id !== member.id) : [...prev, member.id],
                      )
                    }
                  />
                  <Avatar user={member} size={28} online={presence.has(member.id)} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {member.name ?? "Unknown"}
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
