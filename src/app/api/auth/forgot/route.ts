import { readJson, route } from "@/lib/api";
import { db } from "@/lib/db";
import { appUrl, sendMail } from "@/lib/mail";
import { clientAddress, enforce } from "@/lib/rate-limit";
import { RESET_TTL_MINUTES, mintResetToken } from "@/lib/reset-tokens";
import { forgotPasswordSchema } from "@/lib/validation";

/**
 * Starts a password reset.
 *
 * Always returns the same 202, whether or not the address belongs to an
 * account. An endpoint that says "no such user" is a free membership oracle
 * for anyone with a list of email addresses, and this one is unauthenticated.
 *
 * The cost of that choice is that a typo looks identical to success, which is
 * why the response text says "if an account exists" rather than "sent".
 */
export const POST = route(async (req: Request) => {
  await enforce("passwordResetAddress", clientAddress(req));

  const { email } = forgotPasswordSchema.parse(await readJson(req));

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, deactivatedAt: true },
  });

  const eligible = user && !user.deactivatedAt;

  if (eligible) {
    // Per-account limit, so one address cannot be mailbombed by repeated
    // requests even from different client addresses.
    await enforce("passwordReset", user.id);

    // Outstanding tokens are invalidated: a reset request is a statement that
    // the previous link should not be the one that works.
    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { token, tokenHash, expiresAt } = mintResetToken();

    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const link = appUrl(`/reset/${token}`);

    await sendMail({
      to: email,
      subject: "Reset your Thrum password",
      text: [
        "Someone asked to reset the password for this address.",
        "",
        `Open this link to choose a new one (valid for ${RESET_TTL_MINUTES} minutes):`,
        "",
        link,
        "",
        user.passwordHash
          ? ""
          : "Note: this account currently signs in with Google or GitHub. Setting a password will add email sign-in to it.",
        "If you did not ask for this, you can ignore this message -- nothing has changed.",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    });
  }

  return Response.json(
    {
      ok: true,
      message: "If an account exists for that address, a reset link is on its way.",
    },
    { status: 202 },
  );
});
