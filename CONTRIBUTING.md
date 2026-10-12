# Contributing

Thanks for taking a look. This is a small project; the bar is "does it hold up", not ceremony.

## Getting set up

```bash
npm install
npm run db:up        # Postgres 17 in Docker on 127.0.0.1:5432
cp .env.example .env
npx auth secret      # writes AUTH_SECRET into .env
npm run db:setup     # migrate + seed
npm run dev
```

`npm run db:studio` opens Prisma Studio if you want to poke at the data.

## Before you open a pull request

```bash
npm run typecheck    # must pass
npm run build        # must pass -- catches CSP/middleware issues dev does not
```

There is no test suite yet. Until there is, say in the PR description **what you actually ran** to convince yourself the change works. "Signed in as two users in two browser profiles and watched the message arrive" is a real answer; "looks right" is not.

If you touch anything in the list below, please also exercise it in a production build (`npm run build && npm start`) — several of these behave differently from `npm run dev`:

- `src/middleware.ts` — the CSP is nonce-based with `strict-dynamic` **only** in production. A policy that works in dev can still break every script in prod.
- `next.config.ts` — `headers()` is evaluated at **build time**. Anything keyed on a runtime environment variable belongs in `server.ts` instead.
- `server.ts` — not recompiled by HMR; restart it.

## Conventions

- **TypeScript, strict.** No `any` that could be a real type, and no `@ts-expect-error` without a comment saying why.
- **Comments explain *why*, not *what*.** The code already says what it does. If a line looks odd, the comment should say what goes wrong if you "fix" it. There are several of these — the regex in `linkify.tsx`, the raw `UPDATE` in the invite route, the trigger instead of a generated column — and they exist because the obvious alternative is wrong.
- **Match the surrounding style** rather than importing your own. Tailwind utilities with CSS custom properties for colour; no component library.
- Keep server-only modules out of client components. `lib/db`, `lib/authz`, `lib/uploads` and `lib/serialize` import Prisma or `node:fs`; anything a `"use client"` file needs lives in `lib/format`, `lib/channel-label`, `lib/events` or `lib/time`.

## Database changes

Schema changes go through Prisma:

```bash
# edit prisma/schema.prisma, then
npm run db:migrate
```

Commit the generated migration. Two rules learned the hard way:

1. **Do not create indexes or columns outside the schema.** Prisma reads anything it does not know about as drift and then *refuses to run `migrate dev` at all* until the database is reset. If Prisma cannot express what you need, declare the column as `Unsupported(...)` so Prisma owns it, and do the rest in a hand-written migration — the way `Message.searchVector` and its trigger are done.
2. **Triggers are invisible to drift detection**, which is why the search vector is trigger-maintained rather than a `GENERATED ALWAYS AS` column.

If a migration needs an extension (`CREATE EXTENSION`), it must be its own migration ordered *before* anything that uses it — see `20261012081500_enable_pg_trgm`.

## Security-relevant changes

Read [SECURITY.md](SECURITY.md) first; it states the threat model and names the control for each class of attack.

If your change touches authorization, authentication, uploads, raw SQL, or anything rendering user input, please say in the PR which adversary from that threat model you thought about. Specifically:

- New endpoint that lists things? Authorization should be a **join**, not a filter that a later refactor can drop.
- New provider or sign-in path? Decide the email-verification question explicitly.
- New raw SQL? `Prisma.sql` tagged template, always.
- Rendering user input? React elements. Never build HTML from it.

Please do not report vulnerabilities in a pull request or public issue — see [SECURITY.md](SECURITY.md) for private reporting.

## Commit messages

Imperative mood, and say why if it is not obvious:

```
Rate limit sign-in per address and per account

One host spraying many accounts and many hosts targeting one account are
different attacks; a single bucket only stops the first.
```
