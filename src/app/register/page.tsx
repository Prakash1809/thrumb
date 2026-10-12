import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { OAuthButtons } from "@/components/oauth-buttons";
import { RegisterForm } from "@/components/register-form";
import { currentUser, oauthProviders, registrationOpen } from "@/lib/auth";

export const metadata = { title: "Create an account · Thrum" };

export default async function RegisterPage() {
  if (await currentUser()) redirect("/w");
  // The API refuses registration too; this just avoids showing a form that
  // cannot succeed.
  if (!registrationOpen) redirect("/login");

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up a workspace or join one your team already made."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-[var(--color-accent)] hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <OAuthButtons providers={oauthProviders} callbackUrl="/w" />
      <RegisterForm callbackUrl="/w" />
    </AuthShell>
  );
}
