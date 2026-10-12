# Thrum

A self-hosted, Slack-style team chat server. Workspaces, public and private channels, DMs and group DMs, threads, emoji reactions, file attachments, presence, typing indicators, unread badges, edit and delete, invite links, and full-text search — all live over WebSockets.

Built as a single Node process: Next.js and Socket.IO share one HTTP server, so a message goes from `INSERT` to every connected client with no queue and no second service.

> **Status:** a working, hardened personal project — not a product. It has no test suite, no email verification, no password reset, and no 2FA. Read [SECURITY.md](SECURITY.md) before exposing it to the internet; the threat model and a deployment checklist are there.

---

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Realtime | Socket.IO, on the same HTTP server and process as Next |
| Database | Postgres 17 via Prisma |
| Auth | Auth.js v5 — email/password **and** GitHub/Google OAuth |
| Styling | Tailwind CSS v4, no component library |
| Search | Postgres full-text (`tsvector` + GIN) with a `pg_trgm` prefix fallback |
| Uploads | Local disk, behind an authorization check |

## Quick start

Needs Node 20+ and Docker.

```bash
npm install
npm run db:up                 # Postgres 17 on 127.0.0.1:5432

cp .env.example .env
npx auth secret               # writes AUTH_SECRET into .env

npm run db:setup              # migrate + seed demo data
npm run dev                   # http://localhost:3000
```

`db:setup` prints three demo accounts and a working invite link. The demo password is `thrum-demo-9471`; the accounts are `ada@`, `grace@` and `alan@thrum.dev`.

To see presence, typing and live delivery, open two browser profiles signed in as different people.

### OAuth (optional)

Email/password works with no extra setup. Each OAuth button appears only once both of its env vars are set:

- **GitHub** — [create an OAuth app](https://github.com/settings/developers), callback `http://localhost:3000/api/auth/callback/github`
- **Google** — [create OAuth credentials](https://console.cloud.google.com/apis/credentials), redirect URI `http://localhost:3000/api/auth/callback/google`

An OAuth sign-in is refused unless the provider asserts the email is **verified**, so signing in with one provider lands on the existing account for that address rather than creating a second identity — and nobody can claim an address they do not own. See [SECURITY.md](SECURITY.md#oauth-account-linking).

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
- **Unread counts in one query** — a raw SQL join against `ChannelMember` compares each message to that channel's own `lastReadAt`, instead of a query per sidebar row.
- **Denormalised `replyCount` / `lastMessageAt`**, updated in the same transaction as the insert.
- **Scroll anchoring in a layout effect**, so loading older messages corrects the viewport in the same frame rather than visibly jumping.
- **Throttled typing events** — one per 2.5s per typist, expired by TTL on the client, and the server reads the display name once at connect rather than per event.
- **Server-rendered sidebar** on first paint, then live from socket events. (The transcript itself is client-fetched, behind a skeleton.)

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
| `npm run db:up` / `db:down` | Postgres container up/down |
| `npm run db:migrate` | `prisma migrate dev` — for schema changes |
| `npm run db:deploy` | `prisma migrate deploy` — for deployments |
| `npm run db:seed` | Idempotent demo data (refuses to run in production) |
| `npm run db:setup` | deploy + seed |
| `npm run db:studio` | Prisma Studio |

## Project layout

```
server.ts                 Node HTTP server: Next + Socket.IO + socket auth
src/middleware.ts         CSP nonce and CSRF origin check
src/app/api/              Route handlers (REST)
src/app/w/…               Workspace, channel and thread pages
src/app/join/[code]/      Invite redemption
src/components/           UI, all client components except auth-shell
src/hooks/                useChannelMessages — transcript + optimistic sends
src/lib/                  authz, realtime, rate-limit, invites, uploads, …
prisma/schema.prisma      Data model
prisma/migrations/        Including the search trigger and pg_trgm extension
```

Server-only modules (`lib/db`, `lib/authz`, `lib/uploads`, `lib/serialize`) import Prisma or `node:fs`. Anything a client component needs lives in `lib/format`, `lib/channel-label`, `lib/events` or `lib/time`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Note in particular that `npm run build` must pass — several behaviours (the production CSP, build-time header evaluation) differ from `npm run dev`.

## Known limitations

A frank list is in [SECURITY.md](SECURITY.md#known-limitations). The ones most likely to matter:

- Rate limits, presence and typing are **per process** — scaling past one instance needs Redis.
- **No email verification, password reset, or 2FA.**
- Uploads go to **local disk**; `src/lib/uploads.ts` is the only module that touches the filesystem, so moving to S3/R2 is a two-function change.
- **No admin UI.** Roles exist and gate invite management, but removing members and changing roles needs a database edit.
- **Private channels contain only their creator** — there is no add-member flow yet.
- The transcript is **not virtualized**; 40 messages a page is comfortable, tens of thousands of rendered rows would want windowing.
- **No test suite.**

## License

[MIT](LICENSE).
