import { Fragment } from "react";

/**
 * Matches a bare URL or www-prefixed host.
 *
 * Deliberately one greedy character class with nothing after it. The obvious
 * way to avoid linking a trailing full stop is `[^\s<>()]+[^\s<>().,;:!?'"]`,
 * where the final class is a subset of the repeated one -- that is catastrophic
 * backtracking waiting to happen, and since this runs in every reader's browser
 * on every message, a crafted message would freeze their tab. Trailing
 * punctuation is trimmed afterwards in linear code instead.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;

/** Punctuation that ends a sentence rather than a URL. */
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}]+$/;

/**
 * Renders message text with links, as React elements.
 *
 * Deliberately not an HTML-string renderer: message bodies are untrusted user
 * input, and building markup from them would be a stored-XSS hole. Everything
 * here stays text nodes and anchors with a scheme we chose.
 */
export function Linkify({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const full = match[0];

    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));

    // Split the match into the URL and whatever punctuation followed it, so the
    // trimmed characters still render as text rather than disappearing.
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
