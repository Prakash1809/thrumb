"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, primaryButtonClass } from "@/components/auth-shell";
import { api } from "@/lib/fetcher";

type Workspace = { id: string; name: string; slug: string; role?: string };

export function WorkspacePicker({
  workspaces,
  viewerName,
}: {
  workspaces: Workspace[];
  viewerName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy("create");
    setError(null);
    try {
      const data = await api<{ workspace: Workspace; channelId: string | null }>(
        "/api/workspaces",
        { method: "POST", body: { name } },
      );
      router.push(
        data.channelId
          ? `/w/${data.workspace.id}/c/${data.channelId}`
          : `/w/${data.workspace.id}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the workspace");
      setBusy(null);
    }
  }

  /** Accepts a full invite URL or a bare code, and routes to the join page. */
  function openInvite(event: React.FormEvent) {
    event.preventDefault();
    const raw = inviteLink.trim();
    if (!raw) return;

    const code = raw.includes("/join/") ? raw.split("/join/").pop()?.split(/[?#]/)[0] : raw;
    if (!code) {
      setError("That does not look like an invite link");
      return;
    }
    router.push(`/join/${encodeURIComponent(code)}`);
  }

  return (
    <main className="min-h-screen bg-[var(--color-surface-2)] px-4 py-12">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-[var(--color-accent)] text-lg font-bold text-[var(--color-accent-ink)]">
              t
            </span>
            <span className="text-xl font-semibold tracking-tight">Thrum</span>
          </div>
          <button
            type="button"
            className="focus-ring rounded-md px-2 py-1 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)]"
            onClick={() => void signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </button>
        </header>

        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {viewerName}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Open a workspace, redeem an invite, or start something new.
        </p>

        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {workspaces.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Your workspaces
            </h2>
            <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <button
                    type="button"
                    className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-2)]"
                    onClick={() => router.push(`/w/${workspace.id}`)}
                  >
                    <span className="grid size-10 place-items-center rounded-lg bg-[var(--color-rail)] text-base font-bold text-white">
                      {workspace.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{workspace.name}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                        {workspace.slug}
                        {workspace.role === "OWNER" ? " · owner" : ""}
                      </span>
                    </span>
                    <span aria-hidden className="text-[var(--color-ink-muted)]">
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/*
          There is deliberately no list of other workspaces on this server.
          Workspaces are not discoverable, and joining one requires an invite --
          otherwise any account here could enrol itself and read everything.
        */}
        <section className="mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <h2 className="text-sm font-semibold">Have an invite link?</h2>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Workspaces are private. Paste the link an admin sent you.
          </p>
          <form onSubmit={openInvite} className="mt-3 flex gap-2">
            <input
              value={inviteLink}
              placeholder="https://…/join/XXXX  or just the code"
              className={inputClass}
              onChange={(e) => setInviteLink(e.target.value)}
            />
            <button
              type="submit"
              className="focus-ring shrink-0 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-60"
              disabled={!inviteLink.trim()}
            >
              Continue
            </button>
          </form>
        </section>

        <section className="mt-5 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <h2 className="text-sm font-semibold">Create a workspace</h2>
          <form onSubmit={create} className="mt-3 flex gap-2">
            <input
              value={name}
              placeholder="Acme Engineering"
              maxLength={80}
              className={inputClass}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="submit"
              className={`${primaryButtonClass} w-auto whitespace-nowrap`}
              disabled={busy !== null || !name.trim()}
            >
              {busy === "create" ? "Creating..." : "Create"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
