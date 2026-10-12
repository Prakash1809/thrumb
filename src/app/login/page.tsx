import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { OAuthButtons } from "@/components/oauth-buttons";
import { currentUser, oauthProviders, registrationOpen } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata = { title: "Sign in · Thrum" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only accept same-origin paths, so `?next=` cannot be used to bounce
  // someone to another site after they sign in. See lib/safe-redirect.ts for
  // why this is not a `startsWith` check.
  const callbackUrl = safeNextPath(next);

  if (await currentUser()) redirect(callbackUrl);

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Pick up where your team left off."
      footer={
        registrationOpen ? (
          <>
            New here?{" "}
            <Link
              href="/register"
              className="font-medium text-[var(--color-accent)] hover:underline"
            >
              Create an account
            </Link>
          </>
        ) : (
          <>Sign-ups are closed on this server. Ask an admin for an invite.</>
        )
      }
    >
      <OAuthButtons providers={oauthProviders} callbackUrl={callbackUrl} />
      <LoginForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
