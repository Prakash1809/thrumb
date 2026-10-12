import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { db } from "@/lib/db";
import { uniqueUsername } from "@/lib/mentions";
import { verifyPassword } from "@/lib/password";
import { clientAddress, enforce } from "@/lib/rate-limit";
import { isSessionRevoked } from "@/lib/session-revocation";
import { credentialsSchema } from "@/lib/validation";

/**
 * The Prisma adapter, with createUser overridden.
 *
 * `User.username` is required (mentions have to resolve to exactly one
 * account), and the stock adapter knows nothing about it -- so an OAuth
 * sign-up would fail on a not-null violation. Generating the handle here means
 * both sign-up paths, credentials and OAuth, produce a mentionable user.
 */
function adapterWithUsernames(): Adapter {
  const base = PrismaAdapter(db);

  return {
    ...base,
    async createUser(user: AdapterUser) {
      const username = await uniqueUsername(user.name ?? user.email, async (candidate) =>
        Boolean(
          await db.user.findUnique({ where: { username: candidate }, select: { id: true } }),
        ),
      );

      const created = await db.user.create({
        data: {
          email: user.email,
          emailVerified: user.emailVerified,
          name: user.name,
          image: user.image,
          username,
        },
      });

      return {
        id: created.id,
        email: created.email,
        emailVerified: created.emailVerified,
        name: created.name,
        image: created.image,
      } satisfies AdapterUser;
    },
  };
}

/**
 * Which OAuth buttons the sign-in page should render. Credentials are always
 * available; a provider only appears once its two env vars are set.
 */
export const oauthProviders = {
  github: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
};

/** Operators can close sign-ups on a public instance. */
export const registrationOpen = process.env.ALLOW_REGISTRATION !== "0";

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw, request) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;

      const { email, password } = parsed.data;

      /**
       * Brute-force bound, before any database work.
       *
       * Two buckets with very different sizes, and the asymmetry is the point.
       * The per-account bucket is tight -- that is the targeted attack, and one
       * human needs few attempts. The per-address bucket is deliberately large,
       * because a whole organisation usually shares one egress IP and a limit
       * sized for a single person would lock the office out every Monday.
       *
       * enforce throws, which Auth.js surfaces as a failed sign-in, so the
       * person sees the same "those do not match" message and the limit does
       * not become an account-existence oracle.
       */
      await enforce("signInAddress", clientAddress(request));
      await enforce("signInAccount", `account:${email}`);

      const user = await db.user.findUnique({ where: { email } });

      // verifyPassword handles the no-password (OAuth-only) case in constant
      // time, so a wrong password and an unknown email look the same.
      const ok = await verifyPassword(password, user?.passwordHash ?? null);
      if (!ok || !user) return null;

      // A deactivated account must not authenticate. Checked after the password
      // comparison so the timing does not distinguish "wrong password" from
      // "correct password, account disabled".
      if (user.deactivatedAt) return null;

      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  }),
];

if (oauthProviders.github) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      // Linking an OAuth identity to an existing account by email alone is an
      // account-takeover vector if the provider will hand us an address the
      // user never proved they own. It is enabled here ONLY because the signIn
      // callback below refuses any sign-in whose email the provider has not
      // marked verified. Do not enable it without that check.
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

if (oauthProviders.google) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

/**
 * Confirms GitHub considers this address verified.
 *
 * GitHub's /user endpoint happily returns an unverified primary email, so the
 * profile alone proves nothing. /user/emails carries the verified flag, and the
 * token we just received is scoped to read it.
 */
async function githubEmailIsVerified(accessToken: string, email: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "thrum",
      },
    });
    if (!res.ok) return false;

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return false;

    return rows.some(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "email" in row &&
        "verified" in row &&
        String((row as { email: unknown }).email).toLowerCase() === email.toLowerCase() &&
        (row as { verified: unknown }).verified === true,
    );
  } catch {
    // A network failure must fail closed, not wave the sign-in through.
    return false;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: adapterWithUsernames(),
  // Credentials sign-in requires JWT sessions. It also lets server.ts verify a
  // socket handshake by decoding the cookie, with no database round trip.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  // Required because the app runs behind a custom server. Behind a reverse
  // proxy, set AUTH_URL so callback URLs do not depend on the Host header.
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  providers,
  callbacks: {
    /**
     * The gate that makes email-based account linking safe. An OAuth sign-in is
     * refused unless the provider asserts the address is verified, so nobody
     * can claim someone else's email at a provider and inherit their account.
     */
    async signIn({ account, profile }) {
      if (!account || account.provider === "credentials") return true;

      const email = profile?.email;
      if (!email) return false;

      // A deactivated account must not come back in through OAuth. The
      // credentials path checks this separately, after the password compare.
      const existing = await db.user.findUnique({
        where: { email: email.toLowerCase() },
        select: { deactivatedAt: true },
      });
      if (existing?.deactivatedAt) return false;

      if (account.provider === "google") {
        // Google puts this in the ID token; anything but an explicit true fails.
        return (profile as { email_verified?: boolean }).email_verified === true;
      }

      if (account.provider === "github") {
        const token = account.access_token;
        if (typeof token !== "string") return false;
        return githubEmailIsVerified(token, email);
      }

      // An unrecognised provider has not been reviewed for this property.
      return false;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;

      // Resolved once and carried on the token, so rendering the signed-in
      // user does not cost a query on every request. The `!token.username`
      // branch also backfills sessions issued before usernames existed.
      if (token.sub && !token.username) {
        const row = await db.user.findUnique({
          where: { id: token.sub },
          select: { username: true },
        });
        if (row) token.username = row.username;
      }

      // Honour revocation. Returning null signs the session out, which is how
      // a password reset or a deactivation ends an already-issued JWT -- there
      // is no server-side session row to delete. The check is cached, so this
      // is not a database read per request.
      if (token.sub && !user) {
        const iat = typeof token.iat === "number" ? token.iat : undefined;
        if (await isSessionRevoked(token.sub, iat)) return null;
      }

      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      // The JWT payload is an index-signature bag, so narrow rather than trust.
      if (typeof token.username === "string") session.user.username = token.username;
      return session;
    },
  },
});

/** Session user, or null. */
export async function currentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user as {
    id: string;
    username: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

/** Session user, or throw an Unauthorized to be caught by the route wrapper. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}
