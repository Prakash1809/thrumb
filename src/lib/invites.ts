import { createHash, randomBytes } from "node:crypto";

/**
 * Workspace invite codes.
 *
 * A code is a bearer credential: whoever holds it can join the workspace and
 * read its public channels. So it is treated like one --
 *
 *  - 160 bits of CSPRNG entropy, base64url. Guessing is not feasible, which is
 *    what makes the lookup-by-code pattern safe at all.
 *  - Only the SHA-256 digest is stored. A database disclosure yields digests,
 *    not working links. SHA-256 with no salt or stretching is correct here (and
 *    bcrypt would be wrong): the input is already high-entropy random, so there
 *    is no dictionary to attack, and the digest must be deterministic to be
 *    looked up by.
 *  - Lookup is an indexed equality match on that digest, so there is no
 *    byte-by-byte comparison for response timing to leak a prefix through.
 */

const CODE_BYTES = 20;

export type MintedInvite = {
  /** Shown to the creator once. Never persisted. */
  code: string;
  codeHash: string;
  /** Stored so an admin can tell invites apart in a list. */
  codeHint: string;
};

export function mintInviteCode(): MintedInvite {
  const code = randomBytes(CODE_BYTES).toString("base64url");
  return {
    code,
    codeHash: hashInviteCode(code),
    codeHint: code.slice(0, 6),
  };
}

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** Codes are base64url, so anything else is rejected before it reaches the database. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export type InviteState =
  | { usable: true }
  | { usable: false; reason: string };

export function inviteState(invite: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number;
  uses: number;
}): InviteState {
  if (invite.revokedAt) return { usable: false, reason: "This invite has been revoked." };
  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
    return { usable: false, reason: "This invite has expired." };
  }
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    return { usable: false, reason: "This invite has already been used." };
  }
  return { usable: true };
}
