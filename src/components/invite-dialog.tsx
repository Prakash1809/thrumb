"use client";

import { useCallback, useEffect, useState } from "react";

import { inputClass, labelClass, primaryButtonClass } from "@/components/auth-shell";
import { Modal } from "@/components/modal";
import { useWorkspace } from "@/components/workspace-provider";
import { api } from "@/lib/fetcher";
import { shortWhen } from "@/lib/time";

type InviteRow = {
  id: string;
  codeHint: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
  createdBy: { name: string | null } | null;
};

const EXPIRY_CHOICES = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const { workspace } = useWorkspace();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [maxUses, setMaxUses] = useState(0);
  const [expiresInHours, setExpiresInHours] = useState(24 * 7);
  const [role, setRole] = useState<"MEMBER" | "ADMIN">("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ invites: InviteRow[] }>(
        `/api/workspaces/${workspace.id}/invites`,
      );
      setInvites(data.invites);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load invites");
    }
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const data = await api<{ code: string }>(`/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        body: { maxUses, expiresInHours, role },
      });
      setCode(data.code);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invite");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/workspaces/${workspace.id}/invites/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the invite");
    }
  }

  const link = code ? `${window.location.origin}/join/${code}` : null;

  return (
    <Modal
      title={`Invite people to ${workspace.name}`}
      description="Anyone with the link can join, so treat it like a password."
      onClose={onClose}
      wide
    >
      {link && (
        <div className="mb-5 rounded-lg border border-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,transparent)] p-3">
          <p className="mb-2 text-xs font-semibold">
            Copy this now. It is shown once and cannot be recovered.
          </p>
          <div className="flex gap-2">
            <input readOnly value={link} className={`${inputClass} font-mono text-xs`} />
            <button
              type="button"
              className="focus-ring shrink-0 rounded-md border border-[var(--color-line)] px-3 text-sm font-medium hover:bg-[var(--color-surface-2)]"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Only a hash of this code is stored, which is why it cannot be shown again.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="invite-expiry">
            Expires in
          </label>
          <select
            id="invite-expiry"
            className={inputClass}
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
          >
            {EXPIRY_CHOICES.map((choice) => (
              <option key={choice.hours} value={choice.hours}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="invite-uses">
            Max uses
          </label>
          <select
            id="invite-uses"
            className={inputClass}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
          >
            <option value={1}>1 person</option>
            <option value={5}>5 people</option>
            <option value={25}>25 people</option>
            <option value={0}>Unlimited</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="invite-role">
            Joins as
          </label>
          <select
            id="invite-role"
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as "MEMBER" | "ADMIN")}
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <button
        type="button"
        className={`${primaryButtonClass} mt-4`}
        disabled={busy}
        onClick={() => void create()}
      >
        {busy ? "Creating..." : "Create invite link"}
      </button>

      {invites.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Active invites
          </h3>
          <ul className="divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)]">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <code className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-xs">
                  {invite.codeHint}…
                </code>
                <span className="min-w-0 flex-1 text-xs text-[var(--color-ink-muted)]">
                  {invite.role.toLowerCase()} ·{" "}
                  {invite.maxUses === 0
                    ? `${invite.uses} joined`
                    : `${invite.uses}/${invite.maxUses} used`}
                  {invite.expiresAt ? ` · expires ${shortWhen(invite.expiresAt)}` : ""}
                </span>
                <button
                  type="button"
                  className="focus-ring rounded px-2 py-1 text-xs font-semibold text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
                  onClick={() => void revoke(invite.id)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
