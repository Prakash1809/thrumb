import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { db } from "@/lib/db";
import { RESET_TOKEN_PATTERN, hashResetToken } from "@/lib/reset-tokens";

export const metadata = { title: "Choose a new password · Thrum" };

type Props = { params: Promise<{ token: string }> };

export default async function ResetPage({ params }: Props) {
  const { token } = await params;

  /**
   * The token is checked here only to decide whether to render the form -- the
   * reset endpoint validates and consumes it again when the form is submitted.
   * Consuming it on page load would mean a link preview crawler or a browser
   * prefetch could burn someone's only reset link before they saw it.
   */
  const valid =
    RESET_TOKEN_PATTERN.test(token) &&
    (await db.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
      select: { expiresAt: true, usedAt: true, user: { select: { deactivatedAt: true } } },
    }).then(
      (row) =>
        Boolean(row) &&
        !row!.usedAt &&
        row!.expiresAt.getTime() > Date.now() &&
        !row!.user.deactivatedAt,
    ));

  if (!valid) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Reset links are valid for 30 minutes and can only be used once."
        footer={
          <Link href="/login" className="font-medium text-[var(--color-accent)] hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Link
          href="/forgot"
          className="focus-ring block rounded-md bg-[var(--color-accent)] px-3 py-2 text-center text-sm font-semibold text-[var(--color-accent-ink)]"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="This will sign out everywhere else that is using this account."
      footer={
        <Link href="/login" className="font-medium text-[var(--color-accent)] hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
