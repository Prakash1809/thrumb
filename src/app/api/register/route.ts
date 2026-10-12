import { HttpError, conflict, readJson, route } from "@/lib/api";
import { registrationOpen } from "@/lib/auth";
import { db } from "@/lib/db";
import { uniqueUsername } from "@/lib/mentions";
import { hashPassword } from "@/lib/password";
import { clientAddress, enforce } from "@/lib/rate-limit";
import { registerSchema } from "@/lib/validation";

export const POST = route(async (req: Request) => {
  if (!registrationOpen) {
    throw new HttpError(403, "Registration is closed on this server. Ask an admin for an invite.");
  }

  // Bounds automated account creation. Registration is the cheapest endpoint to
  // abuse on a public instance, and every account created here can then read
  // any workspace it holds an invite for.
  await enforce("register", clientAddress(req));

  const { name, email, password } = registerSchema.parse(await readJson(req));

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  if (existing) {
    // The account may exist from an OAuth sign-in with no password set. Adding
    // one here would let anyone who knows the address take it over, so this is
    // a refusal either way; the message points at the fix without confirming
    // which provider the address is on.
    throw conflict("An account with that email already exists. Try signing in instead.");
  }

  // Mentions resolve against this handle, so every account needs one from the
  // moment it exists.
  const username = await uniqueUsername(name || email, async (candidate) =>
    Boolean(await db.user.findUnique({ where: { username: candidate }, select: { id: true } })),
  );

  const user = await db.user.create({
    data: { name, email, username, passwordHash: await hashPassword(password) },
    select: { id: true, name: true, username: true, email: true },
  });

  return Response.json({ user }, { status: 201 });
});
