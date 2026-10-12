/**
 * Sanitises a user-supplied post-sign-in destination.
 *
 * A `startsWith("/") && !startsWith("//")` check is not enough. Browsers
 * normalise backslashes to forward slashes in URLs, so `/\evil.com` becomes
 * `//evil.com` -- a protocol-relative URL that sends the user off-site with our
 * sign-in flow as the referrer. Tab, newline and NUL are also stripped by some
 * parsers before the slash check would ever see them.
 *
 * Rather than enumerate those tricks, resolve the value against a throwaway
 * origin and keep it only if it stayed on that origin. Then rebuild the path
 * from the parsed parts, so whatever comes back is a path and nothing else.
 */
const PLACEHOLDER_ORIGIN = "http://localhost.invalid";

export const DEFAULT_REDIRECT = "/w";

export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return DEFAULT_REDIRECT;
  if (next.length > 512) return DEFAULT_REDIRECT;

  // Control characters have no place in a path and are how header injection
  // and parser-confusion attempts usually arrive.
  for (const char of next) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return DEFAULT_REDIRECT;
  }

  // Backslashes are never meaningful in a path we generate, and are the
  // protocol-relative bypass, so reject outright rather than normalise.
  if (next.includes("\\")) return DEFAULT_REDIRECT;

  if (!next.startsWith("/")) return DEFAULT_REDIRECT;

  let parsed: URL;
  try {
    parsed = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return DEFAULT_REDIRECT;
  }

  // Anything that resolved to a different origin was not a relative path.
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return DEFAULT_REDIRECT;

  const rebuilt = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  // Paranoia: the rebuilt value must still be a single-slash-rooted path.
  if (!rebuilt.startsWith("/") || rebuilt.startsWith("//")) return DEFAULT_REDIRECT;

  return rebuilt;
}
