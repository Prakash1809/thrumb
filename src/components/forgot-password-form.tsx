"use client";

import { useState } from "react";

import { inputClass, labelClass, primaryButtonClass } from "@/components/auth-shell";
import { api } from "@/lib/fetcher";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setPending(true);
    setError(null);

    try {
      await api("/api/auth/forgot", {
        method: "POST",
        body: { email: String(form.get("email") ?? "") },
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  /**
   * The confirmation deliberately does not say whether the address was found.
   * The endpoint behaves identically either way -- saying "no such account"
   * here would turn this unauthenticated form into a membership oracle for
   * anyone holding a list of email addresses.
   */
  if (sent) {
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          If an account exists for that address, a reset link is on its way. It is valid for 30
          minutes.
        </p>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Nothing arrived? Check the spelling, or ask an admin — a self-hosted server may not have
          email configured, in which case the link is in the server log.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div>
        <label className={labelClass} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
          placeholder="you@company.com"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <button type="submit" className={primaryButtonClass} disabled={pending}>
        {pending ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
