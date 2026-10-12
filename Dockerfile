# Multi-stage build. The runtime image carries no compiler, no dev
# dependencies and no build cache -- only what is needed to serve.
#
# Debian slim rather than Alpine on purpose. Prisma needs glibc and OpenSSL,
# which Alpine only gets via `apk add libc6-compat openssl` -- an extra network
# fetch at build time that fails whenever Alpine's CDN is slow or blocked.
# Debian slim already has both, so the build depends on npm's registry and
# nothing else. The image is larger; a build that works is worth more.

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app

# Copy only the manifests first, so a source change does not invalidate the
# dependency layer. The Prisma schema is included because `postinstall` runs
# `prisma generate` and needs it.
COPY package.json package-lock.json ./
COPY prisma ./prisma

# Retries and a low socket count, because an npm registry hiccup should not
# fail a whole image build. `--maxsockets` matters more than the retry count on
# a congested or rate-limited link: npm's default of 15 parallel connections is
# what provokes the resets in the first place.
RUN npm ci --no-audit --no-fund \
      --fetch-retries=8 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=180000 \
      --fetch-timeout=900000 \
      --maxsockets=3

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next build needs *a* value for these, but never the real ones: anything
# inlined at build time would be baked into the image, and an image is not a
# secret store. The real values arrive as runtime environment variables.
# DATABASE_URL is only parsed during the build, never connected to.
ENV NEXT_TELEMETRY_DISABLED=1
ENV AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder

RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Listen on every interface: inside a container, 127.0.0.1 is unreachable from
# the host and from sibling services.
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. The base image ships one (`node`), so there is no
# reason for the server to be root.
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next        ./.next
COPY --from=build --chown=node:node /app/prisma       ./prisma
COPY --chown=node:node package.json next.config.ts tsconfig.json server.ts ./
COPY --chown=node:node src ./src
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/var/uploads /app/public \
 && chown -R node:node /app/var /app/public

# Attachments live here. Declared as a volume so a container replacement does
# not quietly take the uploads with it.
VOLUME ["/app/var"]

USER node

EXPOSE 3000

# The same endpoint an orchestrator would probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start"]
