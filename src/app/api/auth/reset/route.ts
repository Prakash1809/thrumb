import { badRequest, readJson, route } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { clientAddress, enforce } from "@/lib/rate-limit";
import { RESET_TOKEN_PATTERN, hashResetToken } from "@/lib/reset-tokens";
import { revokeSessions } from "@/lib/session-revocation";
import { resetPasswordSchema } from "@/lib/validation";

/**
 * Completes a password reset.
 *
 * The token is consumed in the same transaction as the password change, with
 * `usedAt IS NULL` in the update's WHERE clause. Checking "is it used?" and
 * then marking it used as two statements would let two concurrent submissions
 * of the same link both succeed -- harmless here, but the same shape of bug
 * that matters elsewhere, and this costs nothing to get right.
 */
export const POST = route(async (req: Request) => {
  await enforce("passwordResetAddress", clientAddress(req));

  const { token, password } = resetPasswordSchema.parse(await readJson(req));

  // Reject malformed tokens before touching the database.
  if (!RESET_TOKEN_PATTERN.test(token)) throw badRequest("That reset link is not valid.");

  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { deactivatedAt: true } },
    },
  });

  // One message for every failure mode -- expired, already used, unknown.
  // Distinguishing them tells an attacker which guesses were once real.
  const invalid = () => badRequest("That reset link is invalid or has expired.");

  if (!row) throw invalid();
  if (row.usedAt) throw invalid();
  if (row.expiresAt.getTime() <= Date.now()) throw invalid();
  if (row.user.deactivatedAt) throw invalid();

  const passwordHash = await hashPassword(password);

  const consumed = await db.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Lost the race with another submission of the same link.
    if (claim.count === 0) return false;

    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });

    // Any other outstanding link for this account is now stale.
    await tx.passwordResetToken.updateMany({
      where: { userId: row.userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    return true;
  });

  if (!consumed) throw invalid();

  /**
   * End every session that already exists.
   *
   * This is the point of a reset when an account is compromised: without it,
   * the attacker's existing JWT keeps working for its full lifetime and
   * changing the password accomplishes almost nothing. Sessions are stateless,
   * so revocation is a timestamp comparison -- see lib/session-revocation.ts.
   */
  await revokeSessions(row.userId);

  return Response.json({ ok: true });
});
