import type { UserSummary } from "@/lib/events";

const TINTS = [
  "oklch(0.62 0.16 25)",
  "oklch(0.64 0.14 60)",
  "oklch(0.58 0.13 145)",
  "oklch(0.58 0.15 200)",
  "oklch(0.56 0.16 265)",
  "oklch(0.58 0.16 320)",
];

/** Stable colour per user, so the same person is the same colour everywhere. */
function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 1_000_003;
  return TINTS[hash % TINTS.length];
}

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  user,
  size = 36,
  online,
  className = "",
}: {
  user: UserSummary;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  const dot = Math.max(8, Math.round(size * 0.3));

  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      {user.image ? (
        // Plain <img>: avatar hosts are remote and arbitrary, and these are
        // tiny, so next/image's optimizer would add latency for no gain.
        <img
          src={user.image}
          alt=""
          width={size}
          height={size}
          className="size-full rounded-md object-cover"
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className="grid size-full place-items-center rounded-md font-semibold text-white"
          style={{ background: tintFor(user.id), fontSize: Math.round(size * 0.38) }}
        >
          {initials(user.name)}
        </span>
      )}

      {online !== undefined && (
        <span
          aria-label={online ? "Online" : "Offline"}
          className="absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-[var(--color-surface)]"
          style={{
            width: dot,
            height: dot,
            background: online ? "var(--color-online)" : "var(--color-ink-muted)",
          }}
        />
      )}
    </span>
  );
}
