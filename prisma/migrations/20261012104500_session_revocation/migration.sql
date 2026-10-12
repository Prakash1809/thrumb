-- Revocation instant for stateless sessions.
--
-- Sessions are JWTs, so there is no server-side session table to delete rows
-- from. A password reset or a deactivation stamps this column, and the auth
-- callback refuses any token issued before it -- which is what makes "reset the
-- password of a compromised account" actually end the attacker's access rather
-- than merely stopping them signing in again.
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
