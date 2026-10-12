/**
 * @mention parsing.
 *
 * Mentions resolve against `User.username`, not display name. Display names
 * are not unique and contain spaces, so "@Alan Turing" has no unambiguous end
 * and two Alans would both match. A generated handle makes a mention resolve
 * to exactly one account, which is the whole point of the feature.
 */

/** Matches @handle and the two broadcast forms. Deliberately linear. */
const MENTION_PATTERN = /(?<![\w@])@([a-z0-9][a-z0-9._-]{0,38})/gi;

export const CHANNEL_MENTION = "channel";
export const HERE_MENTION = "here";

export type ParsedMentions = {
  /** Lowercased handles, deduped, excluding the broadcast keywords. */
  usernames: string[];
  /** @channel -- everyone in the channel, notified regardless of presence. */
  channelWide: boolean;
  /** @here -- only members currently online. */
  hereOnly: boolean;
};

export function parseMentions(body: string): ParsedMentions {
  const usernames = new Set<string>();
  let channelWide = false;
  let hereOnly = false;

  for (const match of body.matchAll(MENTION_PATTERN)) {
    const handle = match[1]?.toLowerCase();
    if (!handle) continue;

    if (handle === CHANNEL_MENTION) channelWide = true;
    else if (handle === HERE_MENTION) hereOnly = true;
    else usernames.add(handle);
  }

  return {
    // Capped so one message cannot fan out a thousand mention rows.
    usernames: [...usernames].slice(0, 50),
    channelWide,
    hereOnly,
  };
}

/**
 * Builds a username from a display name or email.
 *
 * Lowercase, dot/underscore/hyphen allowed, must start alphanumeric -- the
 * same shape MENTION_PATTERN accepts, so every generated handle is mentionable.
 */
export function usernameFrom(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;

  let out = "";
  for (const char of base.toLowerCase()) {
    if (/[a-z0-9]/.test(char)) out += char;
    else if (/[\s._-]/.test(char) && out && !out.endsWith(".")) out += ".";
  }

  out = out.replace(/\.+$/, "").slice(0, 32);
  return out || "member";
}

/** Appends a counter until `isTaken` says the handle is free. */
export async function uniqueUsername(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = usernameFrom(base);
  if (!(await isTaken(root))) return root;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  return `${root}.${Date.now().toString(36)}`;
}
