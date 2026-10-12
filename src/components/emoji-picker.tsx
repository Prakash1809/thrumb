"use client";

import { useEffect, useRef } from "react";

/**
 * A fixed palette rather than a full emoji index. The whole Unicode set behind
 * a search box is a megabyte of data for a feature people use with six or seven
 * reactions in practice; this keeps the bundle flat.
 */
export const QUICK_EMOJI = [
  "👍",
  "🎉",
  "❤️",
  "😂",
  "👀",
  "🙏",
  "🔥",
  "✅",
  "🚀",
  "😅",
  "🤔",
  "💯",
  "👏",
  "😍",
  "🙌",
  "😬",
  "🐛",
  "📌",
] as const;

export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    // Capture phase so the picker closes before a click behind it registers.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick a reaction"
      className="absolute right-0 bottom-full z-20 mb-1 grid w-56 grid-cols-6 gap-0.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-lg"
    >
      {QUICK_EMOJI.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React with ${emoji}`}
          className="focus-ring grid size-8 place-items-center rounded text-lg hover:bg-[var(--color-surface-2)]"
          onClick={() => {
            onPick(emoji);
            onClose();
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
