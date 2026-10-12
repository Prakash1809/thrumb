/**
 * Client-safe formatting helpers.
 *
 * Kept out of lib/uploads.ts on purpose: that module imports node:fs, so
 * anything a client component needs has to live here or it drags the whole
 * filesystem API into the browser bundle.
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const INLINE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/** Mirrors the server's decision about what renders in place vs. downloads. */
export function isImageMime(mimeType: string): boolean {
  return INLINE_MIME.has(mimeType.toLowerCase());
}

export function fileListLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}
