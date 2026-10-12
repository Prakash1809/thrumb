"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/avatar";
import { inputClass } from "@/components/auth-shell";
import { HashIcon, LockIcon } from "@/components/icons";
import { Modal } from "@/components/modal";
import { useWorkspace } from "@/components/workspace-provider";
import type { ChannelDTO, MessageDTO } from "@/lib/events";
import { channelLabel } from "@/lib/channel-label";
import { api } from "@/lib/fetcher";
import { shortWhen } from "@/lib/time";

type SearchHit = { message: MessageDTO; channel: ChannelDTO };

const DEBOUNCE_MS = 220;

/** Highlights the matched terms without building HTML from user input. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (escaped.length === 0) return <>{text}</>;

  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  const needles = new Set(terms.map((t) => t.toLowerCase()));

  return (
    <>
      {parts.map((part, index) =>
        needles.has(part.toLowerCase()) ? (
          <mark
            key={index}
            className="rounded bg-[color-mix(in_oklch,var(--color-accent)_28%,transparent)] px-0.5 text-inherit"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    // Debounced so typing a word is one query, not six.
    const timer = setTimeout(() => {
      setSearching(true);
      void api<{ results: SearchHit[] }>(
        `/api/workspaces/${workspace.id}/search?q=${encodeURIComponent(trimmed)}`,
      )
        .then((data) => {
          setResults(data.results);
          setError(null);
        })
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : "Search failed"),
        )
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, workspace.id]);

  const terms = query.trim().split(/\s+/).filter((t) => t.length > 1);

  return (
    <Modal title={`Search ${workspace.name}`} onClose={onClose} wide>
      <input
        value={query}
        placeholder="Search messages"
        className={inputClass}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="mt-4 min-h-24">
        {query.trim().length < 2 && (
          <p className="py-6 text-center text-sm text-[var(--color-ink-muted)]">
            Type at least two characters. Phrases in quotes and{" "}
            <code className="rounded bg-[var(--color-surface-3)] px-1">-exclusions</code> work too.
          </p>
        )}

        {error && (
          <p role="alert" className="py-4 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {query.trim().length >= 2 && !searching && !error && results.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--color-ink-muted)]">
            No messages match that.
          </p>
        )}

        {results.length > 0 && (
          <ul className="scroll-y max-h-[50vh] divide-y divide-[var(--color-line)]">
            {results.map(({ message, channel }) => {
              const isNamed = channel.type === "PUBLIC" || channel.type === "PRIVATE";
              return (
                <li key={message.id}>
                  <button
                    type="button"
                    className="focus-ring w-full px-2 py-3 text-left hover:bg-[var(--color-surface-2)]"
                    onClick={() => {
                      onClose();
                      router.push(`/w/${workspace.id}/c/${channel.id}`);
                    }}
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-muted)]">
                      {channel.type === "PRIVATE" ? (
                        <LockIcon className="size-3" />
                      ) : isNamed ? (
                        <HashIcon className="size-3" />
                      ) : null}
                      <span className="truncate">{channelLabel(channel)}</span>
                      <span aria-hidden>·</span>
                      <span>{shortWhen(message.createdAt)}</span>
                    </div>

                    <div className="flex gap-2.5">
                      <Avatar user={message.user} size={24} />
                      <p className="message-body min-w-0 flex-1 text-sm">
                        <span className="mr-1.5 font-semibold">
                          {message.user.name ?? "Unknown"}
                        </span>
                        <Highlighted text={message.body} terms={terms} />
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
