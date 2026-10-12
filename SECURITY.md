# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository (Security → Report a vulnerability), or email the maintainer listed in the repository profile.

Please include what you did, what happened, and what you expected. A proof of concept helps enormously. You will get an acknowledgement within a few days.

This is a personal project with no paid bug bounty and no formal SLA. It is offered as-is — see [LICENSE](LICENSE).

---

## What this app is, in threat-model terms

A self-hosted team chat server. The assets worth protecting are **message contents**, **attachments**, and **account credentials**. The adversaries worth designing against are:

1. **An unauthenticated internet user.** Can reach `/login`, `/register` and the static assets. Nothing else.
2. **An authenticated user of the instance with no invite.** The main adversary. Signing up must not grant visibility into anybody's workspace.
3. **A workspace member.** May legitimately read their channels. Must not read private channels or DMs they are not in, nor act as another user.
4. **A malicious message author.** Message bodies and filenames are untrusted input rendered in every other member's browser.

Out of scope: a hostile database administrator, a compromised host, and traffic analysis.

---

## Controls, and where they live

### Authorization

Authorization is a **join, not a filter** wherever a list is produced. `requireChannelAccess` ([src/lib/authz.ts](src/lib/authz.ts)) is the single gate for channel reads and writes; message search joins `ChannelMember` for the viewer ([search route](src/app/api/workspaces/%5BworkspaceId%5D/search/route.ts)) so an unreachable message cannot appear even if a filter were forgotten.

- A workspace the viewer is not in returns **404, not 403**, so workspace ids are not confirmable by probing.
- Public channels auto-join on read. Private channels, DMs and group DMs require an existing membership row.
- Attachment downloads re-resolve the key to its message and re-check channel membership ([files route](src/app/api/files/%5B...key%5D/route.ts)).

### Workspaces are not discoverable, and not self-joinable

Joining requires an invite. There is no endpoint that lists the workspaces on an instance, and none that enrols the caller into one by id.

> This was not the original design. The first version returned every workspace on the server from `GET /api/workspaces` and let any authenticated account join any of them, which made signing up equivalent to read access to every public channel on the instance. If you are reading this repo's history, that is what the `invites_and_search` migration replaced.

Invite codes ([src/lib/invites.ts](src/lib/invites.ts)) are 160-bit CSPRNG values, **stored only as a SHA-256 digest**, with an expiry, an optional use limit, and revocation. The plaintext is returned exactly once, at creation. Unsalted SHA-256 is correct here rather than bcrypt: the input is already high-entropy, so there is no dictionary to attack, and the digest has to be deterministic to be looked up by. Use-claiming happens in the `UPDATE ... WHERE ("maxUses" = 0 OR "uses" < "maxUses")` predicate so two concurrent redemptions cannot both pass a check-then-increment.

### Authentication

- Passwords: bcrypt, cost 12. Minimum 10 characters, checked against a small common-password list and a repetitiveness heuristic ([src/lib/password.ts](src/lib/password.ts)). This follows NIST SP 800-63B's "long minimum plus a compromised-secret check" rather than composition rules.
- Sign-in failure is constant-time with respect to whether the account exists: a missing password hash is compared against a throwaway hash rather than returning early.
- Sign-in is rate limited on **two** buckets of deliberately different sizes. Per *account* is tight (10 per 10 minutes) — that is the targeted attack, and one human needs few attempts. Per *address* is large (600 per 10 minutes) because an organisation usually shares one egress IP, and a limit sized for one person locks the whole office out every Monday morning. Getting that asymmetry wrong turns a brute-force defence into a self-inflicted denial of service.
- **Password reset** ([forgot](src/app/api/auth/forgot/route.ts) / [reset](src/app/api/auth/reset/route.ts)): 256-bit CSPRNG token, stored only as a SHA-256 digest, single use, 30-minute expiry. The request endpoint returns an identical response whether or not the address exists, so it is not a membership oracle. The token is consumed inside the same `UPDATE ... WHERE usedAt IS NULL` that changes the password, so two submissions of one link cannot both succeed.
- **Sessions can be revoked.** Sessions are stateless JWTs, so there is no server-side row to delete — instead each user carries `sessionsRevokedAt`, and [lib/session-revocation.ts](src/lib/session-revocation.ts) refuses any token issued before it. A password reset and a deactivation both stamp it. Without this, resetting a compromised account's password would lock the attacker out of future sign-ins while leaving the session they already hold working until it expired. The check is cached for 30 seconds per user, so it does not add a database read to every request; the trade is that revocation can take that long to be felt.
- Sessions are JWTs in an `httpOnly`, `SameSite=Lax` cookie, `Secure` in production.
- **Deactivated accounts** cannot sign in (checked after the password comparison, so timing does not distinguish it from a wrong password), cannot come back in through OAuth, and cannot hold a live socket.

### OAuth account linking

`allowDangerousEmailAccountLinking` is enabled, which by itself is an account-takeover vector: a provider that hands over an address the user never proved they own would let an attacker inherit the matching local account. It is safe here **only** because the `signIn` callback ([src/lib/auth.ts](src/lib/auth.ts)) refuses any OAuth sign-in whose email the provider has not marked verified:

- **Google** — requires `email_verified === true` in the ID token.
- **GitHub** — `/user` will return an *unverified* primary address, so the profile proves nothing. We call `/user/emails` with the fresh access token and require `verified: true` for the matching address. A network failure **fails closed**.
- An unrecognised provider is refused, because it has not been reviewed for this property.

If you add a provider, you must decide this question for it explicitly.

### Mentions and notifications

An `@handle` resolves only to **members of the channel it was written in** ([lib/notify.ts](src/lib/notify.ts)). Naming someone who cannot read the channel would either notify them about content they have no access to, or leave a mention row pointing at a message they cannot open — so it silently does not resolve instead.

The server decides who to notify, not the client. That keeps the preference and mention rules in one place, and means a muted channel costs the client nothing because the event never arrives. An explicit mute (`NONE`) beats someone else's decision to name you: a direct mention into a muted channel stays silent, because the mute is the stronger signal.

`@channel` and `@here` deliberately create no mention rows. They are a notification, not a to-do — persisting them would leave every member with an unread-mention badge they cannot meaningfully clear. `@here` is resolved against live presence server-side, so an offline member is not woken by a stale notification on their next connect.

### CSRF

Mutating requests are checked in [src/middleware.ts](src/middleware.ts): `Sec-Fetch-Site` must be `same-origin` (or `none`, a direct user action), and failing that, `Origin` must match the host the request arrived at.

This matters even though handlers accept JSON: `request.json()` parses the body regardless of `Content-Type`, and a cross-origin HTML form can post `text/plain` with no CORS preflight. `SameSite=Lax` is the first lock; this is the second, and it also closes sibling-subdomain forgery, which Lax permits.

Requests with neither header are allowed — those are non-browser clients, which have no ambient cookie for an attacker to borrow.

### XSS and content injection

- Message bodies are **never** turned into HTML. [MessageText](src/components/message-text.tsx) emits React elements, so a message is text nodes plus anchors with a scheme we chose. There is no `dangerouslySetInnerHTML` anywhere in the codebase.
- CSP is set per response with a fresh nonce, using `strict-dynamic` in production ([src/middleware.ts](src/middleware.ts)). `style-src` allows inline styles — a deliberate, bounded concession, since inline CSS cannot execute script and Next injects `<style>` for route transitions.
- Uploads: only raster images (`png`, `jpeg`, `gif`, `webp`, `avif`) are served inline. **Everything else, including SVG and PDF, is served as `application/octet-stream` with `Content-Disposition: attachment`**, plus `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. An uploaded `.html` or `.svg` therefore cannot execute on this origin.
- The browser's declared MIME type is stored for display only; serving decisions never trust it.

### Path traversal

`resolveKey` ([src/lib/uploads.ts](src/lib/uploads.ts)) resolves every key against the upload root and refuses anything that escapes it. Separately, `ATTACHMENT_KEY_PATTERN` ([src/lib/validation.ts](src/lib/validation.ts)) pins the key shape when a message claims an attachment, and keys are scoped to the posting workspace. Uploaded filenames never enter the path — they are stored as metadata, and the stored name is a random UUID.

### SQL injection

Prisma's query builder everywhere except three raw queries (unread counts, search, invite use-claiming). All three use `Prisma.sql` tagged templates, so every interpolated value is a bound parameter. There is no string concatenation into SQL in this codebase.

### Denial of service

- **Rate limits** on sign-in, registration, password reset, message sends, uploads, search, resource creation, invite minting and invite redemption ([src/lib/rate-limit.ts](src/lib/rate-limit.ts)). Backed by Redis when `REDIS_URL` is set, so the limit is the limit regardless of how many app instances there are; in-memory otherwise, which is correct for one.
- The client address comes from the **TCP peer**, stamped into a header by `server.ts` after deleting any inbound copy — so a client cannot present a fresh identity per request. `X-Forwarded-For` is believed **only** when `TRUST_PROXY=1`, because otherwise anyone could forge it and bypass every per-address limit.
- **Unread counting is bounded by what the viewer has not read**, not by total message volume. The query drives off the viewer's channel memberships with a `LATERAL` subquery and a cap, so one index range scan per channel ([lib/unread.ts](src/lib/unread.ts)). The earlier version scanned the workspace's messages and joined membership onto them, which degrades with history rather than with the reader.
- **Member and channel lists are paginated and searched server-side.** They used to be loaded whole into every client on page load — a thousand-row payload to populate a picker showing eight at a time.
- **Presence is a shared, reference-counted set with a TTL**, so a crashed instance cannot leave people online forever, and a connect no longer reads every member row of every workspace the person belongs to.
- Socket events carry a refilling per-socket budget, because `channel:subscribe` does a database read and an unbounded emit loop would otherwise be a database DoS.
- Typing events read the display name **once at connect**, not per event.
- **ReDoS:** the token-matching regex in `MessageText` is deliberately one alternation of single greedy character classes. The natural way to avoid linking a trailing full stop (`[^\s<>()]+[^\s<>().,;:!?'"]`) nests a subset class after a repeated one — catastrophic backtracking, and since it runs in every reader's browser on every message, a crafted message would freeze their tab. Trailing punctuation is trimmed in linear code instead.
- `maxHttpBufferSize` caps socket payloads at 1MB; attachments go through HTTP.

### Headers

`X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and `poweredByHeader: false`. HSTS is opt-in via `ENABLE_HSTS=1` and is set in `server.ts` — **not** in `next.config.ts`, whose `headers()` runs at build time and would never see a runtime flag.

---

## Deployment hardening checklist

Nothing below is done for you.

[DEPLOYMENT.md](DEPLOYMENT.md) has the commands. This is the list of decisions that are yours.

**Secrets**
- [ ] **Generate a fresh `AUTH_SECRET`** (`openssl rand -base64 32`). Never reuse one from a tutorial, a screenshot, or this repo's history. Anyone who holds it can mint a session for any account. The container entrypoint refuses to start without it.
- [ ] **Change the Postgres password.** `docker-compose.yml` ships `thrum`/`thrum` for local development, bound to `127.0.0.1`. `docker-compose.prod.yml` requires `POSTGRES_PASSWORD` and exposes no host port at all.

**Transport**
- [ ] **Terminate TLS** in front of the app, then set `ENABLE_HSTS=1`. Session cookies are only marked `Secure` over HTTPS, so this is not optional on the internet.
- [ ] **Set `AUTH_URL`** to the exact public origin, scheme included, so callback URLs and the CSRF check do not depend on the `Host` header.
- [ ] **Set `TRUST_PROXY=1` only if** a proxy you control is the only path in *and* it overwrites `X-Forwarded-For`. If the app is directly reachable, leave it off — otherwise a client forges a fresh address per request and every per-address limit stops meaning anything.

**Scale**
- [ ] **Set `REDIS_URL` before running a second app instance.** Without it, rate-limit counters, presence and socket fan-out are per process. Nothing fails loudly: limits allow N times their quota, people show offline, and a message reaches only the instance that received it.
- [ ] **Use sticky sessions** at the load balancer if you run more than one instance. Socket.IO's polling fallback makes several requests per handshake and they must land together.

**Accounts**
- [ ] **Configure SMTP** before onboarding a real team. Without it, password-reset links go to the server log — survivable for a handful of people, a support queue for a hundred.
- [ ] **Consider `ALLOW_REGISTRATION=0`** and inviting people instead. Open registration grants no workspace access, but it does let anyone create an account.
- [ ] **Know how to offboard** before you need to: workspace menu → People → Remove (this workspace) or Deactivate (owner only; signs them out everywhere and blocks sign-in). Messages are kept deliberately.
- [ ] **Do not run the seed script.** It creates accounts whose password is published in this repository. It refuses to run with `NODE_ENV=production` unless `ALLOW_PRODUCTION_SEED=1`, and `SEED_DEMO_DATA` defaults to off.

**Data**
- [ ] **Keep `UPLOAD_DIR` outside `./public`.** Serving it statically would bypass the channel-membership check entirely.
- [ ] **Back up Postgres and the upload directory together.** Attachment rows and files are separate stores; restoring one without the other leaves broken links. Redis needs no backup — everything in it is reconstructible.
- [ ] **Take a database backup before upgrading.** Migrations are forward-only; there are no down migrations.
- [ ] **Put the upload directory on a volume with a quota.** Rate limits bound the rate, not the total.

---

## Known limitations

Stated plainly, because they bound what this app currently is:

| Limitation | Consequence |
| --- | --- |
| Rate limits are **in-process without `REDIS_URL`** | Correct for one instance; with N instances and no Redis each allows the full quota. Set `REDIS_URL` before scaling out — see [DEPLOYMENT.md](DEPLOYMENT.md#sizing). |
| **No email verification** for password sign-up | An address can be registered without proving ownership. It grants no workspace access, but display names are not trustworthy identity. Pair `ALLOW_REGISTRATION=0` with invite links if that matters. |
| Password reset **depends on email being configured** | Without `SMTP_HOST` the link is written to the server log rather than sent. Workable for a handful of people; set SMTP before onboarding a team. |
| Session revocation has a **30-second window** | The revocation check is cached per process to avoid a database read per request, so a reset or deactivation can take up to 30s to end an in-flight session. |
| **No 2FA / MFA** | A leaked password is full account access until it is reset. |
| Common-password list is **small and offline** | A Have I Been Pwned range query would be strictly better. |
| **No audit log** | Administrative actions (invite minting, revocation, role grants) are not recorded beyond their row's `createdById`. |
| **No per-workspace storage quota** | Uploads are rate limited but not capped in total. |
| Deletes are **soft** | A deleted message's row persists with an empty body; it is withheld from the wire, not erased. Attachment rows and reactions *are* hard-deleted, but the file on disk is not yet reaped. |
| Roles gate **invites, member administration and channel removal** | There is no finer-grained permission model than owner / admin / member. |
| **No test suite** | Every control above was verified by driving the live API, not by anything that would catch a regression. The highest-value thing to add. |
| Presence is **per process without `REDIS_URL`** | Two instances each only know their own connections. With Redis it is a shared, reference-counted set with a TTL so a crashed instance cannot strand people online. |
| **Mentions resolve only within the channel** | Naming someone who cannot read the channel silently does not resolve, rather than notifying them about content they cannot open. Intended, but it can surprise. |
| The mention picker loads **at most 200 channel members** | Past that, an unlisted member's handle still resolves when the message is sent — it just is not suggested and renders unhighlighted. |
| **No message retention or export** | Nothing expires, and there is no compliance export. |
| `trustHost: true` | Required by the custom server. Set `AUTH_URL` so host-header manipulation cannot influence callback URLs. |

## Dependency and secret hygiene

- `npm audit` before release; Dependabot is advisable on a public fork.
- `.env`, `*.pem`, `*.key` and `var/` are gitignored. Verify with `git status --ignored` before the first push, and if a secret was ever committed, **rotate it** — removing it from history is not enough.
