"use client";

import { useEffect, useRef } from "react";

import { CloseIcon } from "@/components/icons";

/**
 * Minimal modal. Uses a real <dialog>-like pattern without the element itself,
 * because `showModal()` fights React's control of mounting.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // Move focus into the panel so a keyboard user is not left behind it.
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      "input, textarea, button, [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fade-in w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl ${
          wide ? "max-w-2xl" : "max-w-md"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {description && (
              <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{description}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            className="focus-ring rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
