import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /**
       * Handle used by @mentions. Carried on the session so rendering the
       * signed-in user costs no query on every request.
       */
      username: string;
    } & DefaultSession["user"];
  }
}

// The JWT payload is deliberately not augmented. Auth.js declares
// `interface JWT extends Record<string, unknown>`, so an augmented property
// does not reliably win over that index signature -- reads come back as
// `unknown`. lib/auth.ts narrows the field with an explicit typeof check
// instead, which is honest about the token being loosely typed.
