"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import type { UserSummary } from "@/lib/events";

export type MentionCandidate = UserSummary & { isBroadcast?: boolean; hint?: string };

/**
 * Finds the @mention being typed at the caret.
 *
 * Only an @ that starts a word counts, so an email address does not open the
 * picker. Returns null when the caret is not inside a mention, which is what
 * closes it.
 */
export function mentionQueryAt(
  value: string,
  caret: number,
): { query: string; start: number } | null {
  // Walk back from the caret to the @, bailing on anything that cannot be part
  // of a handle. Cheaper and more predictable than a regex over the whole body.
  let index = caret - 1;

  while (index >= 0) {
    const char = value[index];
    if (char === "@") {
      const before = index > 0 ? value[index - 1] : " ";
      // Must start a word, or it is part of something else (an email).
      if (!/[\w@.]/.test(before)) {
        return { query: value.slice(index + 1, caret), start: index };
      }
      return null;
    }
    if (!/[a-z0-9._-]/i.test(char)) return null;
    // A handle cannot be longer than this, so stop walking.
    if (caret - index > 40) return null;
    index -= 1;
  }

  return null;
}

/**
 * The picker. Keyboard-first: a mention is something you type through, so
 * arrows and Enter have to work without the mouse ever being involved.
 */
export function MentionAutocomplete({
  candidates,
  activeIndex,
  onPick,
  onHover,
}: {
  candidates: MentionCandidate[];
  activeIndex: number;
  onPick: (candidate: MentionCandidate) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the keyboard selection in view when it moves past the fold.
  useEffect(() => {
    const active = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (candidates.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="People to mention"
      className="absolute bottom-full left-0 z-30 mb-1 w-72 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl"
    >
      <ul ref={listRef} className="scroll-y max-h-60">
        {candidates.map((candidate, index) => (
          <li key={candidate.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
                index === activeIndex ? "bg-[var(--color-surface-3)]" : ""
              }`}
              // Mouse down rather than click: the textarea must not lose focus
              // before the insertion happens.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(candidate);
              }}
              onMouseEnter={() => onHover(index)}
            >
              {candidate.isBroadcast ? (
                <span className="grid size-6 shrink-0 place-items-center rounded bg-[var(--color-surface-3)] text-xs font-bold">
                  @
                </span>
              ) : (
                <Avatar user={candidate} size={24} />
              )}

              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {candidate.isBroadcast ? `@${candidate.username}` : candidate.name}
                </span>
                <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                  {candidate.hint ?? `@${candidate.username}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two broadcast handles, offered alongside people. */
export function broadcastCandidates(query: string): MentionCandidate[] {
  const options: MentionCandidate[] = [
    {
      id: "__channel",
      username: "channel",
      name: "@channel",
      image: null,
      isBroadcast: true,
      hint: "Notify everyone in this channel",
    },
    {
      id: "__here",
      username: "here",
      name: "@here",
      image: null,
      isBroadcast: true,
      hint: "Notify everyone currently online",
    },
  ];

  const needle = query.toLowerCase();
  return options.filter((option) => option.username.startsWith(needle));
}

/** Replaces the in-progress handle with the chosen one, plus a trailing space. */
export function applyMention(
  value: string,
  mention: { start: number; query: string },
  username: string,
): { value: string; caret: number } {
  const before = value.slice(0, mention.start);
  const after = value.slice(mention.start + 1 + mention.query.length);
  const inserted = `@${username} `;

  return {
    value: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
  };
}

/** Dedupes and caps a candidate list, keeping people above broadcasts. */
export function useRankedCandidates(
  people: MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  return useMemo(() => {
    const needle = query.toLowerCase();

    const scored = people
      .map((person) => {
        const username = person.username.toLowerCase();
        const name = (person.name ?? "").toLowerCase();
        // Prefix matches rank above substring ones: typing "al" should offer
        // "alan" before "michael".
        if (username.startsWith(needle) || name.startsWith(needle)) return { person, score: 0 };
        if (username.includes(needle) || name.includes(needle)) return { person, score: 1 };
        return null;
      })
      .filter((row): row is { person: MentionCandidate; score: number } => row !== null)
      .sort((a, b) => a.score - b.score)
      .map((row) => row.person);

    return [...scored, ...broadcastCandidates(query)].slice(0, limit);
  }, [people, query, limit]);
}

/** Keyboard handling shared by the composer, kept here with the picker. */
export function useMentionKeys({
  open,
  count,
  activeIndex,
  setActiveIndex,
  onPick,
  onClose,
}: {
  open: boolean;
  count: number;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const [, force] = useState(0);

  /** Returns true when the key was consumed by the picker. */
  return (event: React.KeyboardEvent): boolean => {
    if (!open || count === 0) return false;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((activeIndex + 1) % count);
        force((n) => n + 1);
        return true;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((activeIndex - 1 + count) % count);
        force((n) => n + 1);
        return true;
      case "Enter":
      case "Tab":
        event.preventDefault();
        onPick(activeIndex);
        return true;
      case "Escape":
        event.preventDefault();
        onClose();
        return true;
      default:
        return false;
    }
  };
}
