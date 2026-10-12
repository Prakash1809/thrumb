import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-surface-2)] p-6 text-center">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nothing here</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          This channel or workspace does not exist, or you do not have access to it.
        </p>
        <Link
          href="/w"
          className="focus-ring mt-6 inline-block rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-accent-ink)]"
        >
          Back to your workspaces
        </Link>
      </div>
    </main>
  );
}
