# Thrum

A self-hosted, Slack-style team chat server. Workspaces, public and private channels, DMs and group DMs, threads, **@mentions**, **desktop notifications**, emoji reactions, file attachments, presence, typing indicators, unread and mention badges, edit and delete, invite links, member administration, password reset, and full-text search — all live over WebSockets.

Built as a single Node process: Next.js and Socket.IO share one HTTP server, so a message goes from `INSERT` to every connected client with no queue and no second service.

> **Status:** a working, hardened personal project — not a product. No test suite, no email verification, no 2FA. Read [SECURITY.md](SECURITY.md) before exposing it to the internet, and [DEPLOYMENT.md](DEPLOYMENT.md) to run it.
>
> Sized for **up to ~1000 people** on one box with Redis. See [sizing](DEPLOYMENT.md#sizing).

---

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Realtime | Socket.IO, on the same HTTP server and process as Next |
| Database | Postgres 17 via Prisma |
| Shared state | Redis — rate limits, presence, socket fan-out (optional on one instance) |
| Auth | Auth.js v5 — email/password **and** GitHub/Google OAuth |
| Styling | Tailwind CSS v4, no component library |
| Search | Postgres full-text (`tsvector` + GIN) with a `pg_trgm` prefix fallback |
| Uploads | Local disk, behind an authorization check |

## Quick start

Needs Node 20+ and Docker.

```bash
npm install
npm run db:up                 # Postgres + Redis on 127.0.0.1

cp .env.example .env
npx auth secret               # writes AUTH_SECRET into .env

npm run db:setup              # migrate + seed demo data
npm run dev                   # http://localhost:3000
```

To run the whole thing in containers instead — app, Postgres and Redis, with migrations applied on start:

```bash
cp .env.docker.example .env.docker   # set AUTH_SECRET and POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml --env-file .env.docker up -d --build
```

> **Untested.** The image build was never completed here (npm timing out inside the container), so the `Dockerfile` and prod compose file are written but unverified — see the note at the top of [DEPLOYMENT.md](DEPLOYMENT.md). The `npm run dev` path above is verified end to end.

`db:setup` prints three demo accounts and a working invite link. The demo password is `thrum-demo-9471`; the accounts are `ada@`, `grace@` and `alan@thrum.dev`.

To see presence, typing and live delivery, open two browser profiles signed in as different people.

### OAuth (optional)

Email/password works with no extra setup. Each OAuth button appears only once both of its env vars are set:

- **GitHub** — [create an OAuth app](https://github.com/settings/developers), callback `http://localhost:3000/api/auth/callback/github`
- **Google** — [create OAuth credentials](https://console.cloud.google.com/apis/credentials), redirect URI `http://localhost:3000/api/auth/callback/google`

An OAuth sign-in is refused unless the provider asserts the email is **verified**, so signing in with one provider lands on the existing account for that address rather than creating a second identity — and nobody can claim an address they do not own. See [SECURITY.md](SECURITY.md#oauth-account-linking).

---

## What it does

**Messaging** — public and private channels, 1:1 DMs, group DMs, one-level threads, emoji reactions, edit and soft delete, file attachments with inline image preview, link autolinking.

**Being reachable** — `@mentions` with keyboard autocomplete, `@channel` and `@here`, desktop notifications, per-channel notification levels (every message / mentions only / nothing), a separate mention badge that outranks the unread count, and an unread count in the tab title.

**Finding things** — full-text search with stemming and a prefix fallback, scoped to what you can actually read. A mentions feed.

**Who is here** — presence, typing indicators, unread counts per channel.

**Running it** — invite links with expiry, use limits, roles and revocation; member administration (roles, removal, deactivation); channel membership; password reset; closable registration; a health endpoint; container stack with migrations on start.

Not here: calls, apps and webhooks, rich text, mobile apps, SSO/SCIM, retention policies. See [known limitations](#known-limitations).

---

## How it fits together

### One process, one socket

[`server.ts`](server.ts) creates the Node HTTP server, hands requests to Next, and attaches Socket.IO to the same server. Because they share a process, a route handler can broadcast directly after a write commits — [`src/lib/realtime.ts`](src/lib/realtime.ts) parks the `io` instance on `globalThis` and the API routes emit through it. No message queue, no second service, no HTTP hop between "saved" and "delivered".

A socket handshake is authenticated by decoding the Auth.js session cookie, so no socket in any room is ever anonymous. On connect, the server pre-joins every workspace and channel room the user belongs to, which is why a message posted anywhere they can see arrives without a client-side subscribe round trip.

### Writes go over HTTP; updates come back over the socket

Sending a message is a `POST`, not a socket emit. The POST validates, authorizes, and commits in a transaction; the socket then carries the result to everyone, including the sender. One authorization path, every write replayable with `curl`, and a dropped socket never loses a message.

Sends still feel instant: the composer renders an optimistic row carrying a `clientId`, the server echoes that `clientId` on the broadcast, and the real message replaces the placeholder instead of appearing beside it ([`use-channel-messages.ts`](src/hooks/use-channel-messages.ts)).

### Channels and DMs are one table

`Channel.type` is `PUBLIC | PRIVATE | DM | GROUP`, so messages, threads, reactions, read state and search have exactly one code path rather than parallel channel and conversation implementations. A DM has no name; it is identified by `dmKey`, a sorted fingerprint of its participants under a unique index — so two people opening the same DM at the same moment converge on one channel instead of racing two into existence.

### Things that are fast on purpose

- **Keyset pagination** on the transcript (`createdAt, id` cursor), so rows never shift under a reader when someone posts mid-scroll.
- **Denormalised `replyCount` / `lastMessageAt`**, updated in the same transaction as the insert.
- **Scroll anchoring in a layout effect**, so loading older messages corrects the viewport in the same frame rather than visibly jumping.
- **Throttled typing events** — one per 2.5s per typist, expired by TTL on the client, and the server reads the display name once at connect rather than per event.
- **Server-rendered sidebar** on first paint, then live from socket events. (The transcript itself is client-fetched, behind a skeleton.)
- **Unread counting scales with what you have not read**, not with total history — one bounded index range scan per channel, driven off the viewer's memberships rather than the workspace's messages.
- **Member and channel lists are paginated and searched server-side**, so a thousand-person workspace does not ship a thousand rows into every page.

### Mentions and notifications

An `@handle` resolves against `User.username`, not a display name — a mention has to resolve to exactly one person, and display names are neither unique nor delimited. Handles are generated on sign-up by both the credentials and OAuth paths.

The **server** decides who to notify, not the client ([lib/notify.ts](src/lib/notify.ts)). That keeps the preference and mention rules in one place, and a muted channel costs the client nothing because the event never arrives. `@here` is resolved against live presence server-side, so an offline member is not woken by a stale notification on their next connect.

Mentions are stored in their own table rather than found by searching message bodies, so "what mentioned me" is an indexed lookup and the badge survives the message being edited. Notification work happens after the response is prepared and is not awaited into it: the message is already committed and broadcast, so a slow preference lookup must not delay the sender's `201`.

### Search

Two matchers, OR'd: a stored `tsvector` column with a GIN index handles stemming, phrases and negation (`deployed` finds `Deploy`; `deploy -staging` works), and a `pg_trgm` index on `body` catches prefixes a stemmer will not match (`laten` finds `Latency`).

The vector is maintained by a **trigger**, not a generated column, and the column is declared in `schema.prisma` as `Unsupported("tsvector")`. That combination is deliberate: Prisma cannot express a generated column or a functional index, and anything it does not know about reads as schema drift — which makes `prisma migrate dev` refuse to run until the database is reset. Triggers are invisible to drift detection, so this keeps the column Prisma-managed and migrations working. See [CONTRIBUTING.md](CONTRIBUTING.md#database-changes).

---

## Security

The full threat model, control-by-control notes, and a deployment checklist are in **[SECURITY.md](SECURITY.md)**. The short version:

- **Workspaces are not discoverable and not self-joinable.** Joining needs an invite code: 160 bits of CSPRNG, stored only as a SHA-256 digest, with expiry, use limits and revocation.
- **Authorization is a join, not a filter**, wherever a list is produced — including search, so a message in a channel you are not in cannot surface.
- **Message bodies are never rendered as HTML.** No `dangerouslySetInnerHTML` anywhere.
- **Uploads**: only raster images are served inline; everything else downloads with `nosniff` and a locked-down CSP, so an uploaded `.html` or `.svg` cannot execute on this origin. Downloads re-check channel membership.
- **CSP with a per-response nonce** and `strict-dynamic` in production; CSRF checked via `Sec-Fetch-Site`/`Origin` on every mutating request.
- **Rate limits** on sign-in (per address *and* per account), registration, sends, uploads, search and invites. The client address is taken from the TCP peer, not a forgeable header.

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md#reporting-a-vulnerability).

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next + Socket.IO on `:3000` |
| `npm run build` | Production build |
| `npm start` | Production server (run `build` first) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:up` / `db:down` | Postgres + Redis containers up/down |
| `npm run db:migrate` | `prisma migrate dev` — for schema changes |
| `npm run db:deploy` | `prisma migrate deploy` — for deployments |
| `npm run db:seed` | Idempotent demo data (refuses to run in production) |
| `npm run db:setup` | deploy + seed |
| `npm run db:studio` | Prisma Studio |
| `docker compose -f docker-compose.prod.yml up -d --build` | Full self-hosted stack — see [DEPLOYMENT.md](DEPLOYMENT.md) |

## Project layout

```
server.ts                   Node HTTP server: Next + Socket.IO, socket auth,
                            client-IP stamping, HSTS, graceful shutdown
src/middleware.ts           CSP nonce + CSRF origin check, on every request

src/app/api/                Route handlers (REST)
  auth/forgot, auth/reset     Password reset
  invites/[code]              Invite preview and redemption
  channels/[id]/members       Channel membership (what makes private usable)
  workspaces/[id]/members     Member list, roles, removal, deactivation
  workspaces/[id]/mentions    Mention feed and mark-read
  workspaces/[id]/notifications  Per-channel notification levels
  health                      Liveness/readiness for an orchestrator

src/app/w/…                 Workspace, channel and thread pages
src/app/join/[code]/        Invite redemption
src/app/forgot, reset/[t]   Password reset

src/components/             UI (client components except auth-shell)
src/hooks/
  use-channel-messages        Transcript + optimistic sends
  use-channel-members         Mention candidates + known handles
  use-notifications           Desktop notifications + title badge

src/lib/
  authz                       The single authorization gate
  notify                      Who gets notified, and why
  mentions                    @handle parsing and username generation
  rate-limit                  Redis-or-memory limiter
  presence                    Reference-counted, shared, TTL'd
  session-revocation          Revoking stateless JWTs
  redis, mail, invites, reset-tokens, uploads, unread, serialize, …

prisma/schema.prisma        Data model
prisma/migrations/          Including pg_trgm, the search trigger, and the
                            hand-written username backfill
docker/entrypoint.sh        Config checks, wait-for-db, migrate, then serve
```

**Client/server module split.** `lib/db`, `lib/authz`, `lib/uploads`, `lib/serialize`, `lib/notify`, `lib/presence`, `lib/redis`, `lib/mail` and `lib/session-revocation` import Prisma, `node:fs` or a socket — they are server-only. Anything a `"use client"` file needs lives in `lib/format`, `lib/channel-label`, `lib/events`, `lib/time` or `lib/mentions`. Crossing that line is how Prisma ends up in the browser bundle.

## Deploying

[DEPLOYMENT.md](DEPLOYMENT.md) covers the container stack, TLS and reverse-proxy configuration (including the WebSocket headers people forget), sizing from 10 to 1000+ people, SMTP, backups, upgrades, offboarding and troubleshooting.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Note in particular that `npm run build` must pass — several behaviours (the production CSP, build-time header evaluation) differ from `npm run dev`.

## Known limitations

The full list with reasoning is in [SECURITY.md](SECURITY.md#known-limitations). The ones most likely to matter:

- **No test suite.** Everything here was verified by driving the live API, which catches today's bugs and not next week's regressions. This is the first thing I would add.
- **No email verification and no 2FA.** Password reset exists, but needs SMTP configured to actually deliver — without it the link goes to the server log.
- Rate limits, presence and socket fan-out are **per process without `REDIS_URL`** — correct for one instance, quietly wrong for two. Set it before scaling out.
- Session revocation has a **30-second window**, because the check is cached to avoid a database read per request.
- Uploads go to **local disk** with no per-workspace quota. `src/lib/uploads.ts` is the only module that touches the filesystem, so moving to S3/R2 is a two-function change.
- **No audit log.** Role changes, removals and invite minting are not recorded beyond the row they touch.
- The transcript is **not virtualized**; 40 messages a page is comfortable, tens of thousands of rendered rows would want windowing.
- **No rich text.** Messages are plain text plus autolinked URLs and mentions — deliberately, since rendering user input as markup is where XSS lives.
- **Threads are one level deep**, like Slack. Replying to a reply replies to the thread.
- **No down migrations.** Back up before upgrading.

## License

[MIT](LICENSE).
