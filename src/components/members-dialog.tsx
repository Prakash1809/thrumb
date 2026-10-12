"use client";

import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/avatar";
import { inputClass } from "@/components/auth-shell";
import { Modal } from "@/components/modal";
import { useWorkspace, type WorkspaceMemberSummary, type WorkspaceRole } from "@/components/workspace-provider";
import { api } from "@/lib/fetcher";

const DEBOUNCE_MS = 200;

const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

/**
 * Workspace member administration: change a role, remove someone, or
 * deactivate an account.
 *
 * This exists because without it, offboarding required editing Postgres by
 * hand -- and a chat server where a departing employee keeps reading
 * everything until someone runs SQL is not one you can put a company on.
 */
export function MembersDialog({ onClose }: { onClose: () => void }) {
  const { workspace, viewer, viewerRole, presence, searchMembers } = useWorkspace();

  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<WorkspaceMemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isOwner = viewerRole === "OWNER";
  const canManage = viewerRole !== "MEMBER";

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const rows = await searchMembers(q);
        setMembers(rows);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load members");
      } finally {
        setLoading(false);
      }
    },
    [searchMembers],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function changeRole(member: WorkspaceMemberSummary, role: WorkspaceRole) {
    setBusyId(member.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/workspaces/${workspace.id}/members/${member.id}`, {
        method: "PATCH",
        body: { role },
      });
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role } : m)));
      setNotice(`${member.name ?? member.username} is now ${role.toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change that role");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(member: WorkspaceMemberSummary, deactivate: boolean) {
    const what = deactivate
      ? `Deactivate ${member.name ?? member.username}? They will be signed out everywhere and cannot sign in again.`
      : `Remove ${member.name ?? member.username} from ${workspace.name}? Their messages stay, but they lose access immediately.`;

    if (!confirm(what)) return;

    setBusyId(member.id);
    setError(null);
    setNotice(null);
    try {
      await api(
        `/api/workspaces/${workspace.id}/members/${member.id}${deactivate ? "?deactivate=1" : ""}`,
        { method: "DELETE" },
      );
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      setNotice(
        deactivate
          ? `${member.name ?? member.username} has been deactivated.`
          : `${member.name ?? member.username} has been removed.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that person");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      title={`People in ${workspace.name}`}
      description={
        canManage
          ? "Change roles, remove people, or deactivate an account."
          : "Everyone in this workspace."
      }
      onClose={onClose}
      wide
    >
      <input
        value={query}
        placeholder="Search by name, @handle or email"
        className={inputClass}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
      {notice && <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{notice}</p>}

      <ul className="scroll-y mt-4 max-h-[55vh] divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)]">
        {loading && (
          <li className="px-3 py-6 text-center text-sm text-[var(--color-ink-muted)]">Loading…</li>
        )}

        {!loading && members.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-[var(--color-ink-muted)]">
            Nobody matches that.
          </li>
        )}

        {!loading &&
          members.map((member) => {
            const isSelf = member.id === viewer.id;
            // Only an owner may touch another owner -- enforced server-side
            // too; this just avoids offering a control that would be refused.
            const mayEdit = canManage && (isOwner || member.role !== "OWNER");

            return (
              <li key={member.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Avatar user={member} size={32} online={presence.has(member.id)} />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {member.name ?? member.username}
                    {isSelf && (
                      <span className="ml-1.5 text-xs font-normal text-[var(--color-ink-muted)]">
                        you
                      </span>
                    )}
                    {member.deactivated && (
                      <span className="ml-1.5 rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-ink-muted)]">
                        deactivated
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                    @{member.username}
                    {member.email ? ` · ${member.email}` : ""}
                  </span>
                </span>

                {mayEdit ? (
                  <select
                    aria-label={`Role for ${member.name ?? member.username}`}
                    className="focus-ring rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                    value={member.role}
                    disabled={busyId === member.id}
                    onChange={(e) => void changeRole(member, e.target.value as WorkspaceRole)}
                  >
                    {ROLES.filter((role) => isOwner || role !== "OWNER").map((role) => (
                      <option key={role} value={role}>
                        {role.charAt(0) + role.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs font-semibold uppercase text-[var(--color-ink-muted)]">
                    {member.role}
                  </span>
                )}

                {mayEdit && !isSelf && (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="focus-ring rounded px-2 py-1 text-xs font-semibold text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                      disabled={busyId === member.id}
                      onClick={() => void remove(member, false)}
                    >
                      Remove
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        title="Signs them out everywhere and blocks sign-in"
                        className="focus-ring rounded px-2 py-1 text-xs font-semibold text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                        disabled={busyId === member.id}
                        onClick={() => void remove(member, true)}
                      >
                        Deactivate
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
      </ul>
    </Modal>
  );
}
