"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

/** Renders only the providers that are actually configured in the environment. */
export function OAuthButtons({
  providers,
  callbackUrl,
}: {
  providers: { github: boolean; google: boolean };
  callbackUrl: string;
}) {
  const [pending, setPending] = useState<string | null>(null);

  if (!providers.github && !providers.google) return null;

  const start = (provider: string) => {
    setPending(provider);
    void signIn(provider, { callbackUrl });
  };

  const buttonClass =
    "focus-ring flex w-full items-center justify-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--color-surface-2)] disabled:opacity-60";

  return (
    <>
      <div className="grid gap-2">
        {providers.google && (
          <button
            type="button"
            className={buttonClass}
            disabled={pending !== null}
            onClick={() => start("google")}
          >
            <svg viewBox="0 0 24 24" aria-hidden className="size-4">
              <path
                fill="#4285F4"
                d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.7z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24z"
              />
              <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z" />
              <path
                fill="#EA4335"
                d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"
              />
            </svg>
            {pending === "google" ? "Opening Google..." : "Continue with Google"}
          </button>
        )}

        {providers.github && (
          <button
            type="button"
            className={buttonClass}
            disabled={pending !== null}
            onClick={() => start("github")}
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-current">
              <path d="M8 0a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2 .4-2.5-.5-2.7-1 0-.1-.4-.9-.8-1-.3-.2-.7-.6 0-.6.6 0 1 .6 1.2.9.7 1.2 1.8.9 2.3.7.1-.5.3-.9.6-1.1-2-.3-3.3-1-3.3-3.3 0-.7.2-1.3.7-1.8-.1-.2-.3-.9.1-1.8 0 0 .6-.2 2 .7a5.5 5.5 0 0 1 2.9 0c1.4-.9 2-.7 2-.7.4.9.2 1.6.1 1.8.5.5.7 1.1.7 1.8 0 2.3-1.4 3-3.3 3.3.4.3.7.9.7 1.8v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0z" />
            </svg>
            {pending === "github" ? "Opening GitHub..." : "Continue with GitHub"}
          </button>
        )}
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-[var(--color-ink-muted)]">
        <span className="h-px flex-1 bg-[var(--color-line)]" />
        or
        <span className="h-px flex-1 bg-[var(--color-line)]" />
      </div>
    </>
  );
}
