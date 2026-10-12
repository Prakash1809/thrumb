"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { primaryButtonClass } from "@/components/auth-shell";
import { api } from "@/lib/fetcher";

/**
 * The accept button. Redemption is a POST, not a side effect of loading the
 * page: a GET that consumes a single-use invite would be spent by a link
 * preview crawler or a prefetch before the person ever saw it.
 */
export function JoinWorkspace({
  code,
  workspaceName,
}: {
  code: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ workspaceId: string; channelId: string | null }>(
        `/api/invites/${encodeURIComponent(code)}`,
        { method: "POST" },
      );
      router.replace(
        data.channelId ? `/w/${data.workspaceId}/c/${data.channelId}` : `/w/${data.workspaceId}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <button
        type="button"
        className={primaryButtonClass}
        disabled={busy}
        onClick={() => void accept()}
      >
        {busy ? "Joining..." : `Join ${workspaceName}`}
      </button>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <a
        href="/w"
        className="focus-ring rounded-md px-3 py-2 text-center text-sm font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
      >
        Not now
      </a>
    </div>
  );
}
