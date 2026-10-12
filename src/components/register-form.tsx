"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, labelClass, primaryButtonClass } from "@/components/auth-shell";
import { api } from "@/lib/fetcher";

export function RegisterForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setPending(true);
    setError(null);

    try {
      await api("/api/register", {
        method: "POST",
        body: { name: String(form.get("name") ?? ""), email, password },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
      setPending(false);
      return;
    }

    // Sign straight in, so creating an account is one step from the user's side.
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError("Account created, but signing in failed. Try signing in.");
      setPending(false);
      return;
    }

    router.replace(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div>
        <label className={labelClass} htmlFor="name">
          Display name
        </label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          className={inputClass}
          placeholder="Ada Lovelace"
        />
      </div>

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

      <div>
        <label className={labelClass} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={inputClass}
          placeholder="At least 8 characters"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <button type="submit" className={primaryButtonClass} disabled={pending}>
        {pending ? "Creating account..." : "Create account"}
      </button>
    </form>
  );
}
