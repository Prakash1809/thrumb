-- Adds @mentions, notification preferences, password reset, and account
-- deactivation.
--
-- Hand-written rather than generated, because `User.username` is a required
-- unique column being added to a table that already has rows: Prisma's
-- generated step would be a bare `ADD COLUMN ... NOT NULL`, which cannot
-- succeed. The column is therefore added nullable, backfilled with a derived
-- and de-duplicated handle, and only then constrained.

-- ---------------------------------------------------------------------------
-- User: username + deactivation
-- ---------------------------------------------------------------------------

ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

-- Derive a handle from the display name, falling back to the local part of the
-- email, then disambiguate collisions with a counter. Mirrors
-- usernameFrom() in src/lib/mentions.ts so handles minted by either path have
-- the same shape.
WITH derived AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(
        regexp_replace(
          regexp_replace(
            lower(COALESCE(NULLIF("name", ''), split_part("email", '@', 1))),
            '[^a-z0-9]+', '.', 'g'
          ),
          '(^\.+)|(\.+$)', '', 'g'
        ),
        ''
      ),
      'member'
    ) AS handle
  FROM "User"
),
numbered AS (
  SELECT
    "id",
    handle,
    row_number() OVER (PARTITION BY handle ORDER BY "id") AS rn
  FROM derived
)
UPDATE "User" u
   SET "username" = CASE WHEN n.rn = 1 THEN n.handle ELSE n.handle || n.rn::text END
  FROM numbered n
 WHERE n."id" = u."id";

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

CREATE INDEX "User_deactivatedAt_idx" ON "User"("deactivatedAt");

-- ---------------------------------------------------------------------------
-- Password reset
-- ---------------------------------------------------------------------------

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Mentions
-- ---------------------------------------------------------------------------

CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Mention_messageId_userId_key" ON "Mention"("messageId", "userId");
CREATE INDEX "Mention_userId_readAt_idx" ON "Mention"("userId", "readAt");
CREATE INDEX "Mention_userId_workspaceId_createdAt_idx" ON "Mention"("userId", "workspaceId", "createdAt" DESC);
CREATE INDEX "Mention_channelId_idx" ON "Mention"("channelId");

ALTER TABLE "Mention"
  ADD CONSTRAINT "Mention_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Mention"
  ADD CONSTRAINT "Mention_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Notification preferences
-- ---------------------------------------------------------------------------

CREATE TYPE "NotificationLevel" AS ENUM ('ALL', 'MENTIONS', 'NONE');

CREATE TABLE "NotificationPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT,
    "level" "NotificationLevel" NOT NULL DEFAULT 'MENTIONS',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("id")
);

-- Postgres treats NULLs as distinct, so the workspace-wide default row (null
-- channelId) coexists with per-channel overrides without colliding.
CREATE UNIQUE INDEX "NotificationPref_userId_workspaceId_channelId_key"
  ON "NotificationPref"("userId", "workspaceId", "channelId");
CREATE INDEX "NotificationPref_userId_workspaceId_idx"
  ON "NotificationPref"("userId", "workspaceId");

ALTER TABLE "NotificationPref"
  ADD CONSTRAINT "NotificationPref_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
