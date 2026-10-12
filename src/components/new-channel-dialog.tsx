"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { inputClass, labelClass, primaryButtonClass } from "@/components/auth-shell";
import { Modal } from "@/components/modal";
import { useWorkspace } from "@/components/workspace-provider";
import type { ChannelDTO } from "@/lib/events";
import { api } from "@/lib/fetcher";

export function NewChannelDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { workspace, refreshChannels } = useWorkspace();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const { channel } = await api<{ channel: ChannelDTO }>(
        `/api/workspaces/${workspace.id}/channels`,
        { method: "POST", body: { name, topic, isPrivate } },
      );
      await refreshChannels();
      onClose();
      router.push(`/w/${workspace.id}/c/${channel.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the channel");
      setPending(false);
    }
  }

  return (
    <Modal
      title="Create a channel"
      description="Channels are where your team talks about one topic."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div>
          <label className={labelClass} htmlFor="channel-name">
            Name
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-ink-muted)]">#</span>
            <input
              id="channel-name"
              value={name}
              required
              maxLength={64}
              placeholder="product-launch"
              className={inputClass}
              // Typed spaces become hyphens as you go, so the validation error
              // never has to fire for the most common mistake.
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="channel-topic">
            Topic <span className="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="channel-topic"
            value={topic}
            maxLength={250}
            placeholder="What is this channel about?"
            className={inputClass}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <label className="flex items-start gap-2.5 rounded-md border border-[var(--color-line)] p-3">
          <input
            type="checkbox"
            checked={isPrivate}
            className="mt-0.5"
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">Make private</span>
            {/* Honest about the current limitation: there is no add-member flow
                for channels yet, so a private channel is yours alone. */}
            <span className="block text-xs text-[var(--color-ink-muted)]">
              Hidden from everyone else. Adding other people to a private channel
              is not supported yet, so for now it will be just you. This cannot be
              changed later.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <button type="submit" className={primaryButtonClass} disabled={pending || !name}>
          {pending ? "Creating..." : "Create channel"}
        </button>
      </form>
    </Modal>
  );
}
