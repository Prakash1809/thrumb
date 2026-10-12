import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { badRequest, notFound, tooLarge } from "@/lib/api";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

/**
 * Local disk storage. Everything funnels through saveUpload/readUpload, so
 * swapping in S3 or R2 later is a two-function change and no caller moves.
 */
function uploadRoot(): string {
  const configured = process.env.UPLOAD_DIR ?? "var/uploads";
  return path.resolve(process.cwd(), configured);
}

/** Only these render inline. Everything else downloads. */
const INLINE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

export function isInlineMime(mimeType: string): boolean {
  return INLINE_MIME.has(mimeType.toLowerCase());
}

const NUL = String.fromCharCode(0);

/** True for ASCII control characters and DEL, which have no place in a filename. */
function isControlChar(code: number): boolean {
  return code < 32 || code === 127;
}

/**
 * Resolves a stored key to an absolute path, refusing anything that escapes the
 * upload root. Keys come from the database, but a request can name an arbitrary
 * one, so `..` segments and absolute paths have to be rejected here.
 */
function resolveKey(key: string): string {
  if (!key || key.includes(NUL)) throw badRequest("Invalid file key");
  const root = uploadRoot();
  const target = path.resolve(root, key);
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(withSep)) throw badRequest("Invalid file key");
  return target;
}

const UNSAFE_NAME_CHARS = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|"]);

/** Strips directory parts and characters that are unsafe in a filename. */
export function safeFileName(name: string): string {
  const base = path.basename(name);
  let out = "";
  for (const char of base) {
    const code = char.charCodeAt(0);
    if (isControlChar(code)) continue;
    out += UNSAFE_NAME_CHARS.has(char) ? "_" : char;
  }
  return out.trim().slice(0, 180) || "file";
}

export type SavedUpload = {
  key: string;
  name: string;
  mimeType: string;
  size: number;
};

export async function saveUpload(workspaceId: string, file: File): Promise<SavedUpload> {
  if (file.size <= 0) throw badRequest("File is empty");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw tooLarge(`Files must be ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB or smaller`);
  }

  const name = safeFileName(file.name || "file");
  const ext = path.extname(name).slice(0, 12);
  const now = new Date();
  const dir = path.posix.join(
    workspaceId,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
  );
  const key = path.posix.join(dir, `${randomUUID()}${ext}`);

  const target = resolveKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await file.arrayBuffer()));

  return {
    key,
    name,
    // Never trust the browser's label for anything but display; serving
    // decisions go through isInlineMime, and responses carry nosniff.
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
}

export async function readUpload(key: string): Promise<Buffer> {
  const target = resolveKey(key);
  try {
    const info = await stat(target);
    if (!info.isFile()) throw notFound("File not found");
  } catch {
    throw notFound("File not found");
  }
  return readFile(target);
}
