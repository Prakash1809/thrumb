import { createHash, randomBytes } from "node:crypto";

/**
 * Password reset tokens.
 *
 * Same treatment as invite codes, for the same reason: this is a bearer
 * credential that grants control of an account. 256 bits of CSPRNG, stored
 * only as a SHA-256 digest, single use, and short lived.
 *
 * SHA-256 unsalted is the right primitive here even though we hash passwords
 * with bcrypt -- the input is already uniformly random, so there is nothing to
 * brute force, and the digest must be deterministic to be looked up by.
 */

const TOKEN_BYTES = 32;

export const RESET_TTL_MINUTES = 30;

export function mintResetToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
  };
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
