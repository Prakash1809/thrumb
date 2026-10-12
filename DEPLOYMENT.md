# Deploying Thrum

Self-hosting guide. For the threat model and the reasoning behind each control, read [SECURITY.md](SECURITY.md).

> **The container path in this document has not been run end to end.**
>
> The image build was never completed on the machine this was written on — `npm ci` inside the container kept failing on network timeouts, so the `Dockerfile`, `docker-compose.prod.yml` and `docker/entrypoint.sh` are written but **unverified**. Expect to debug them a little on first use; the likely places are the `npm ci` step and the entrypoint's wait-for-database loop.
>
> What *is* verified, end to end against a running server: the app itself under `npm run dev` and `npm start`, with Postgres and Redis in containers. If you want a known-good starting point, run the app on the host (see the [README](README.md#quick-start)) and use compose for the two dependencies only.

---

## The short version

```bash
git clone <your-fork> thrum && cd thrum

cp .env.docker.example .env.docker
# Fill in the two required values:
openssl rand -base64 32          # -> AUTH_SECRET
openssl rand -base64 24          # -> POSTGRES_PASSWORD

docker compose -f docker-compose.prod.yml --env-file .env.docker up -d --build
```

That brings up three containers — app, Postgres, Redis — applies migrations on start, and listens on `127.0.0.1:3000`. Put a reverse proxy in front for TLS (below).

The first account to register becomes the owner of whatever workspace it creates. There is no bootstrap admin: workspaces are created by people, not by configuration.

Check it came up:

```bash
curl -s localhost:3000/api/health
# {"status":"ok","checks":{"database":"ok","redis":"ok"}}
```

---

## Sizing

| People | What you need |
| --- | --- |
| **Up to ~200** | One app container. Redis optional — without it, rate limits and presence are per-process, which is correct for one instance. |
| **200–1000** | One app container is still enough for the socket count; add Redis so you can restart without losing presence, and so you *can* scale out. 2 vCPU / 4GB for the app, 2 vCPU / 4GB for Postgres. |
| **1000+** | Two or more app instances behind a sticky-session load balancer, Redis **required**, Postgres with a connection pooler. |

Redis stops being optional the moment you run a second instance. Without it, each one keeps its own rate-limit counters (so the effective limit is N times what it says), its own presence map (so people show offline), and its own Socket.IO rooms (so a message only reaches whoever happened to connect to the same instance). None of that fails loudly — it just quietly misbehaves, which is worse.

### Scaling out

```yaml
# docker-compose.prod.yml
services:
  app:
    deploy:
      replicas: 3
    ports: []        # the proxy reaches the service, not the host
```

WebSockets need **sticky sessions** at the load balancer. Socket.IO's HTTP long-polling fallback makes several requests per handshake, and they must land on the same instance. Set `ip_hash` (nginx), `sticky` (Traefik), or `lb_cookie` (Caddy).

---

## TLS

The app does not terminate TLS. Session cookies are only marked `Secure` over HTTPS, so this is not optional for anything on the internet.

<details>
<summary>Caddy (easiest — automatic certificates)</summary>

```caddy
chat.example.com {
    reverse_proxy localhost:3000
}
```

Caddy sets `X-Forwarded-For` correctly and handles the WebSocket upgrade with no extra configuration.
</details>

<details>
<summary>nginx</summary>

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    # Attachments. Must be at least MAX_UPLOAD_BYTES or uploads fail at the proxy.
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Required for WebSockets.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        # Overwrite, never append: the app only trusts this because the proxy
        # sets it, and an appended client-supplied value would be forgeable.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Sockets are long-lived; the default 60s read timeout cuts them.
        proxy_read_timeout 7d;
    }
}
```
</details>

Then set these in `.env.docker` and restart:

```ini
AUTH_URL=https://chat.example.com
TRUST_PROXY=1
ENABLE_HSTS=1
```

`TRUST_PROXY=1` makes the app believe `X-Forwarded-For` for rate limiting. **Only set it when the proxy is the only way in**, and when it *overwrites* that header — otherwise a client can forge a fresh address per request and walk through every per-address limit.

---

## Email

Without `SMTP_HOST`, password-reset links are written to the container log instead of being sent:

```bash
docker compose -f docker-compose.prod.yml logs app | grep -A3 "EMAIL NOT CONFIGURED"
```

That is survivable for a handful of people and not for a hundred — someone forgets their password every week, and each one becomes a support request. Set SMTP before you onboard a real team.

```ini
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=thrum@example.com
SMTP_PASSWORD=...
MAIL_FROM=Thrum <thrum@example.com>
```

---

## Backups

Two stores, and they must be backed up **together** — attachment rows live in Postgres while the files live on disk, so restoring one without the other leaves broken links.

```bash
# Database
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U thrum thrum | gzip > thrum-$(date +%F).sql.gz

# Attachments
docker run --rm -v thrum_thrum-uploads:/data -v "$PWD:/backup" \
  busybox tar czf /backup/thrum-uploads-$(date +%F).tar.gz -C /data .
```

Redis needs no backup. Rate-limit counters and presence are both reconstructible, which is why persistence is disabled on it.

Restore:

```bash
gunzip -c thrum-2026-01-01.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U thrum thrum
docker run --rm -v thrum_thrum-uploads:/data -v "$PWD:/backup" \
  busybox tar xzf /backup/thrum-uploads-2026-01-01.tar.gz -C /data
```

---

## Upgrading

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.docker up -d --build
```

Migrations run automatically on container start, via `prisma migrate deploy` — which only applies committed migrations and never generates, resets, or prompts. (`migrate dev` is a development command and can drop data to resolve drift; the entrypoint deliberately does not use it.)

**Take a database backup before upgrading.** Migrations are forward-only; there are no down migrations.

A restart drops every WebSocket. Clients reconnect within a second or two and resync, so no messages are lost, but people will see a brief "Reconnecting…". For zero-downtime you need two or more instances and a rolling update.

---

## Operations

### Making someone an admin

There is no CLI. Sign in as an owner → workspace menu → **People** → change their role. The first person to create a workspace is its owner.

If you have locked yourself out of ownership entirely:

```sql
-- Last resort. Prefer the UI.
UPDATE "WorkspaceMember" SET role = 'OWNER'
WHERE "userId" = (SELECT id FROM "User" WHERE email = 'you@example.com')
  AND "workspaceId" = (SELECT id FROM "Workspace" WHERE slug = 'your-workspace');
```

### Offboarding

Workspace menu → **People** → **Remove** (loses access to this workspace) or **Deactivate** (owner only — signs them out everywhere immediately and blocks future sign-in).

Their messages stay in both cases. Deleting them would tear holes in every thread they replied to, and the goal is revoking access, not rewriting history.

### Closing registration

```ini
ALLOW_REGISTRATION=0
```

Existing accounts still sign in; new people join only through an invite link. Sensible for a company instance.

### Disk

Attachments are rate limited but not capped in total. Put `/app/var` on a volume with a quota and watch it:

```bash
docker system df -v | grep thrum-uploads
```

---

## Troubleshooting

**`FATAL: AUTH_SECRET is not set`** — the entrypoint refuses to start without it, on purpose. Anyone who knows that value can mint a session for any account.

**`database unreachable after 60 attempts`** — Postgres did not come up. `docker compose -f docker-compose.prod.yml logs postgres`. Usually a `POSTGRES_PASSWORD` that changed after the volume was initialised; the password is baked in at first start.

**Messages arrive only after a refresh** — the WebSocket is not connecting. Almost always a proxy missing the `Upgrade`/`Connection` headers, or multiple instances without sticky sessions.

**`Cross-site request blocked` on every action** — `AUTH_URL` does not match the origin the browser is actually using. Set it to the exact public origin, scheme included.

**Everyone is being rate limited** — `TRUST_PROXY=1` with a proxy that does not set `X-Forwarded-For`, so every request looks like it comes from one address. Either fix the proxy or set it back to `0`.

**Uploads fail at around 1MB** — the reverse proxy's body limit, not the app's. See `client_max_body_size` above.

---

## What this does not do

Stated plainly so you can decide whether it fits:

- **No email verification.** An address can be registered without proving ownership. Combine `ALLOW_REGISTRATION=0` with invite links if that matters.
- **No 2FA.** A leaked password is full account access until it is reset.
- **No audit log.** Invite minting, role changes and removals are not recorded beyond the row they touch.
- **No per-workspace storage quota.**
- **No message retention or compliance export.**
- **Attachments on local disk.** `src/lib/uploads.ts` is the only module that touches the filesystem, so moving to S3-compatible storage is a two-function change.
- **No down migrations.**

The full list, with the reasoning, is in [SECURITY.md](SECURITY.md#known-limitations).
