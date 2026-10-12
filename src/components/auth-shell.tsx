import Link from "next/link";

/** Centred card used by the sign-in and sign-up pages. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-surface-2)] px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-[var(--color-accent)] text-lg font-bold text-[var(--color-accent-ink)]">
            t
          </span>
          <span className="text-xl font-semibold tracking-tight">Thrum</span>
        </Link>

        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 mb-5 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
          {children}
        </div>

        <p className="mt-5 text-center text-sm text-[var(--color-ink-muted)]">{footer}</p>
      </div>
    </main>
  );
}

export const inputClass =
  "focus-ring w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm placeholder:text-[var(--color-ink-muted)]";

export const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]";

export const primaryButtonClass =
  "focus-ring w-full rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-accent-ink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
