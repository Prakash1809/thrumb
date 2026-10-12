"use client";

/**
 * The one-line prompt to turn on desktop notifications.
 *
 * Shown as a dismissible strip rather than a browser permission dialog on
 * load. `Notification.permission === "denied"` cannot be undone from script --
 * once a user clicks Block, the only cure is digging through site settings --
 * so the prompt has to be something they opt into, with the reason visible.
 */
export function NotificationBanner({
  onEnable,
  onDismiss,
}: {
  onEnable: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)] px-4 py-2 text-sm">
      <span className="min-w-0 flex-1">
        Turn on notifications so you know when someone needs you.
      </span>
      <button
        type="button"
        className="focus-ring shrink-0 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[var(--color-accent-ink)]"
        onClick={onEnable}
      >
        Turn on
      </button>
      <button
        type="button"
        className="focus-ring shrink-0 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
        onClick={onDismiss}
      >
        Not now
      </button>
    </div>
  );
}
