import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Reset your password · Thrum" };

export default async function ForgotPage() {
  // Already signed in: there is nothing to recover.
  if (await currentUser()) redirect("/w");

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
      footer={
        <Link href="/login" className="font-medium text-[var(--color-accent)] hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
