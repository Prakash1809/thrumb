import type { AttachmentDTO } from "@/lib/events";
import { formatBytes, isImageMime } from "@/lib/format";

export function AttachmentList({ attachments }: { attachments: AttachmentDTO[] }) {
  if (attachments.length === 0) return null;

  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((attachment) =>
        isImageMime(attachment.mimeType) ? (
          <li key={attachment.id}>
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring block overflow-hidden rounded-lg border border-[var(--color-line)]"
            >
              {/* Dimensions are unknown until someone measures them server-side,
                  so the box is capped and the image fits inside it. */}
              <img
                src={attachment.url}
                alt={attachment.name}
                loading="lazy"
                className="max-h-72 max-w-sm object-contain"
              />
            </a>
          </li>
        ) : (
          <li key={attachment.id}>
            <a
              href={attachment.url}
              download={attachment.name}
              className="focus-ring flex items-center gap-2.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm hover:bg-[var(--color-surface-3)]"
            >
              <span className="grid size-8 place-items-center rounded bg-[var(--color-surface-3)] text-xs font-semibold uppercase text-[var(--color-ink-muted)]">
                {attachment.name.split(".").pop()?.slice(0, 4) ?? "file"}
              </span>
              <span className="min-w-0">
                <span className="block max-w-56 truncate font-medium">{attachment.name}</span>
                <span className="block text-xs text-[var(--color-ink-muted)]">
                  {formatBytes(attachment.size)}
                </span>
              </span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}
