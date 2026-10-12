"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, labelClass, primaryButtonClass } from "@/components/auth-shell";
import { api } from "@/lib/fetcher";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      await api("/api/auth/reset", { method: "POST", body: { token, password } });
      setDone(true);
      // Every existing session for this account was just revoked, including any
      // the person was holding, so they have to sign in again on purpose.
      setTimeout(() => router.push("/login"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password");
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">Password changed.</p>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Everywhere that was signed in to this account has been signed out. Taking you to sign
          in…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div>
        <label className={labelClass} htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className={inputClass}
          placeholder="At least 10 characters"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="confirm">
          Confirm
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className={inputClass}
          placeholder="Type it again"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <button type="submit" className={primaryButtonClass} disabled={pending}>
        {pending ? "Saving..." : "Set new password"}
      </button>
    </form>
  );
}
