# Contributing

Thanks for taking a look. This is a small project; the bar is "does it hold up", not ceremony.

## Getting set up

```bash
npm install
npm run db:up        # Postgres + Redis on 127.0.0.1
cp .env.example .env
npx auth secret      # writes AUTH_SECRET into .env
npm run db:setup     # migrate + seed
npm run dev
```

`npm run db:studio` opens Prisma Studio if you want to poke at the data.

**Redis is optional in development.** Leave `REDIS_URL` unset and rate limits, presence and socket fan-out run in process, which is correct for one instance. Set it (`redis://127.0.0.1:6379`) when you are touching any of those three, because the in-memory path will happily hide a bug that only appears with two instances.

**Email is optional too.** Without `SMTP_HOST`, password-reset links are printed to the server log instead of sent — which is how you test the reset flow locally.

## Before you open a pull request

```bash
npm run typecheck    # must pass
npm run build        # must pass -- catches CSP/middleware issues dev does not
```

There is no test suite yet. Until there is, say in the PR description **what you actually ran** to convince yourself the change works. "Signed in as two users in two browser profiles and watched the message arrive" is a real answer; "looks right" is not.

If you touch anything below, exercise it in a production build (`npm run build && npm start`) — these behave differently from `npm run dev`:

- **`src/middleware.ts`** — the CSP is nonce-based with `strict-dynamic` **only** in production. A policy that works in dev can still block every script in prod.
- **`next.config.ts`** — `headers()` is evaluated at **build time**. Anything keyed on a runtime environment variable belongs in `server.ts` instead; HSTS lives there for exactly this reason.
- **`server.ts`** — not recompiled by HMR; restart it.
- **Anything touching Redis** — run with `REDIS_URL` set, then again without, and check both paths.

## Conventions

- **TypeScript, strict.** No `any` that could be a real type, and no `@ts-expect-error` without a comment saying why.
- **Comments explain *why*, not *what*.** The code already says what it does. If a line looks odd, the comment should say what goes wrong if you "fix" it. There are a lot of these, and they are load-bearing — see the list below.
- **Match the surrounding style** rather than importing your own. Tailwind utilities with CSS custom properties for colour; no component library.

### Keep server-only code out of client components

`lib/db`, `lib/authz`, `lib/uploads`, `lib/serialize`, `lib/notify`, `lib/presence`, `lib/redis`, `lib/mail` and `lib/session-revocation` import Prisma, `node:fs` or a socket. Anything a `"use client"` file needs lives in `lib/format`, `lib/channel-label`, `lib/events`, `lib/time` or `lib/mentions`.

This has bitten twice already: `formatBytes` once lived beside `node:fs` and `channelLabel` beside Prisma, each of which drags a whole runtime into the browser bundle.

## Things that look wrong and are not

Before "simplifying" any of these, read the comment above it:

| Where | Why it is like that |
| --- | --- |
| The regex in `message-text.tsx` | One alternation of single greedy classes. The natural way to avoid linking a trailing full stop nests a subset class after a repeated one — catastrophic backtracking, in every reader's browser, on every message. |
| `Message.searchVector` is a column with a trigger | Prisma cannot express a generated column *or* a functional index. Declaring the column lets Prisma own it; triggers are invisible to drift detection. |
| The raw `UPDATE` in the invite and reset routes | The guard is in the `WHERE` clause so two concurrent redemptions cannot both pass a check-then-increment. |
| `unreadSummary`'s `LATERAL` subquery | Drives off the viewer's memberships, so cost tracks what they have not read rather than total history. |
| Sign-in's two rate-limit buckets have wildly different sizes | Per account is tight; per address is huge because an office shares one IP. A per-address limit sized for one human locks out everyone behind the NAT. |
| `notify.ts` decides recipients server-side | One place for the rules, and a muted channel costs the client nothing because the event never arrives. |
| `enforce()` is `async` | It may hit Redis. Every call site must `await` it or the limit silently does nothing. |
| `session-revocation.ts` caches for 30s | Otherwise it is a database read on every authenticated request. The trade is stated in SECURITY.md. |
| `notificationPref` uses findFirst-then-write, not `upsert` | The workspace-wide row is keyed by a NULL `channelId`, and Prisma's compound-unique `where` cannot express null. |
| The Dockerfile uses Debian slim, not Alpine | Prisma needs glibc and OpenSSL; on Alpine that means an extra `apk add` network fetch that fails whenever their CDN is slow. |

## Database changes

```bash
# edit prisma/schema.prisma, then
npm run db:migrate
```

Commit the generated migration. Three rules learned the hard way:

1. **Never create indexes, columns or constraints outside the schema.** Prisma reads anything it does not know about as drift and then *refuses to run `migrate dev` at all* until the database is reset. If Prisma cannot express what you need, declare the column as `Unsupported(...)` so Prisma owns it and do the rest in a hand-written migration — the way `Message.searchVector` is done.
2. **Triggers are invisible to drift detection**, which is why the search vector is trigger-maintained rather than a `GENERATED ALWAYS AS` column.
3. **Extensions need their own migration**, ordered *before* anything that uses them — see `20261012081500_enable_pg_trgm`. A combined migration fails on a fresh database because the operator class does not exist yet.

Adding a **required** column to a table that already has rows cannot be done by `migrate dev` — it generates a bare `ADD COLUMN ... NOT NULL`, which fails. Write the migration by hand: add it nullable, backfill, then constrain. `20261012101500_mentions_notifications_reset` does this for `User.username`, including de-duplicating derived handles.

Deployments use `prisma migrate deploy`, never `migrate dev` — deploy only applies committed migrations and never generates, resets or prompts.

## Security-relevant changes

Read [SECURITY.md](SECURITY.md) first; it states the threat model and names the control for each class of attack.

If your change touches authorization, authentication, uploads, raw SQL, mentions, or anything rendering user input, say in the PR which adversary from that threat model you thought about. Specifically:

- **New endpoint that lists things?** Authorization should be a **join**, not a filter a later refactor can drop. And paginate it — two endpoints have already had to be rewritten because they loaded every row into every client.
- **New provider or sign-in path?** Decide the email-verification question explicitly. `allowDangerousEmailAccountLinking` is only safe because the `signIn` callback refuses unverified addresses.
- **New raw SQL?** `Prisma.sql` tagged template, always. No string concatenation into a statement, ever.
- **Rendering user input?** React elements. Never build HTML from it, and watch the regex complexity.
- **New rate limit?** Decide whether it is per account or per address, and size it for a NAT if the latter.
- **New notification trigger?** It belongs in `lib/notify.ts` with the rest of the rules, not in the route that happens to fire it.

Please do not report vulnerabilities in a pull request or public issue — see [SECURITY.md](SECURITY.md#reporting-a-vulnerability) for private reporting.

## Commit messages

Imperative mood, and say why if it is not obvious:

```
Rate limit sign-in per address and per account

One host spraying many accounts and many hosts targeting one account are
different attacks; a single bucket only stops the first. The address bucket
is deliberately large because an office shares one egress IP.
```
