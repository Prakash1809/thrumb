#!/bin/sh
set -e

# Container entrypoint.
#
# Two jobs before handing off to the server: refuse to start misconfigured, and
# bring the database schema up to date.

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is not set." >&2
  exit 1
fi

if [ -z "$AUTH_SECRET" ] || [ "$AUTH_SECRET" = "build-time-placeholder-not-used-at-runtime" ]; then
  echo "FATAL: AUTH_SECRET is not set (or is still the build placeholder)." >&2
  echo "       Anyone who knows it can mint a session for any account." >&2
  echo "       Generate one with:  openssl rand -base64 32" >&2
  exit 1
fi

# Wait for Postgres. Compose's depends_on with a healthcheck usually covers
# this, but a managed database can still be a moment behind the container.
echo "  waiting for the database..."
ATTEMPTS=0
until npx --no-install prisma db execute --stdin <<'SQL' >/dev/null 2>&1
SELECT 1;
SQL
do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "FATAL: database unreachable after 60 attempts." >&2
    exit 1
  fi
  sleep 2
done

# `migrate deploy`, never `migrate dev`: deploy only applies committed
# migrations and never generates, resets or prompts. Running dev here could
# drop data to resolve drift.
echo "  applying migrations..."
npx --no-install prisma migrate deploy

# Optional demo data. Off unless explicitly asked for, because the seed creates
# accounts whose password is published in the README.
if [ "$SEED_DEMO_DATA" = "1" ]; then
  echo "  seeding demo data (SEED_DEMO_DATA=1)..."
  ALLOW_PRODUCTION_SEED=1 npx --no-install tsx prisma/seed.ts || \
    echo "  seed failed; continuing without it." >&2
fi

echo "  starting Thrum..."
exec "$@"
