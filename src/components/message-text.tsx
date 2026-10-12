import { Fragment } from "react";

/**
 * Renders message text with links and @mentions, as React elements.
 *
 * Deliberately not an HTML-string renderer: message bodies are untrusted user
 * input, and building markup from them would be a stored-XSS hole. Everything
 * here stays text nodes, anchors with a scheme we chose, and spans.
 */

/**
 * One pass, one alternation, no nesting.
 *
 * The tempting way to avoid linking a trailing full stop is
 * `[^\s<>()]+[^\s<>().,;:!?'"]` -- a subset class after a repeated one, which
 * is catastrophic backtracking waiting to happen. This runs in every reader's
 * browser on every message, so a crafted message would freeze their tab.
 * Trailing punctuation is trimmed afterwards in linear code instead.
 */
const TOKEN_PATTERN =
  /(?<![\w@])@([a-z0-9][a-z0-9._-]{0,38})|\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;

const TRAILING_PUNCTUATION = /[.,;:!?'")\]}]+$/;

const BROADCAST_HANDLES = new Set(["channel", "here"]);

export function MessageText({
  text,
  viewerUsername,
  /** Handles known to exist, so an unresolvable @typo renders as plain text. */
  knownUsernames,
}: {
  text: string;
  viewerUsername?: string;
  knownUsernames?: ReadonlySet<string>;
}) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    const full = match[0];
    const handle = match[1]?.toLowerCase();

    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));

    if (handle) {
      const isBroadcast = BROADCAST_HANDLES.has(handle);
      // An unknown handle is almost always a typo or a plain email-ish string,
      // and styling it as a mention would imply it notified someone.
      const resolved = isBroadcast || !knownUsernames || knownUsernames.has(handle);
      const isSelf = isBroadcast || handle === viewerUsername?.toLowerCase();

      if (!resolved) {
        nodes.push(full);
      } else {
        nodes.push(
          <span
            key={`${start}-mention`}
            className={
              isSelf
                ? "rounded bg-[color-mix(in_oklch,var(--color-danger)_22%,transparent)] px-1 font-semibold"
                : "rounded bg-[color-mix(in_oklch,var(--color-accent)_16%,transparent)] px-1 font-medium text-[var(--color-accent)]"
            }
          >
            {full}
          </span>,
        );
      }
    } else {
      // Split the match into the URL and whatever punctuation followed it, so
      // the trimmed characters still render rather than disappearing.
      const url = full.replace(TRAILING_PUNCTUATION, "");
      const suffix = full.slice(url.length);

      if (url) {
        const href = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
        nodes.push(
          <a key={`${start}-link`} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {url}
          </a>,
        );
      } else {
        nodes.push(full);
      }

      if (suffix) nodes.push(suffix);
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));

  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>{node}</Fragment>
      ))}
    </>
  );
}
