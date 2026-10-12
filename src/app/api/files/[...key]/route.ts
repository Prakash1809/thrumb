import { badRequest, forbidden, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess, requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { isInlineMime, readUpload, safeFileName } from "@/lib/uploads";

type Params = { params: Promise<{ key: string[] }> };

/** RFC 5987 filename, so non-ASCII names survive the header. */
function contentDisposition(name: string, inline: boolean): string {
  const fallback = safeFileName(name).replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const GET = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { key: segments } = await params;

  const key = segments.join("/");
  const workspaceId = segments[0];
  if (!workspaceId || segments.length < 2) throw badRequest("Invalid file key");

  const attachment = await db.attachment.findFirst({
    where: { key },
    select: {
      name: true,
      mimeType: true,
      message: { select: { channelId: true, workspaceId: true, deletedAt: true } },
    },
  });

  let name: string;
  let mimeType: string;

  if (attachment) {
    if (attachment.message.deletedAt) throw forbidden("That file is no longer available");
    // The real check: you can read the file if you can read the channel the
    // message lives in. Private channels and DMs are covered by this.
    await requireChannelAccess(user.id, attachment.message.channelId);
    name = attachment.name;
    mimeType = attachment.mimeType;
  } else {
    // Uploaded but not yet posted — the composer is previewing it. Keys are
    // random UUIDs under a workspace prefix, so workspace membership is the
    // right gate until a message claims the file.
    await requireWorkspaceMember(user.id, workspaceId);
    name = segments[segments.length - 1] ?? "file";
    mimeType = "application/octet-stream";
  }

  const bytes = await readUpload(key);
  const inline = isInlineMime(mimeType);

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": inline ? mimeType : "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition(name, inline),
      // Only raster images render in place. Anything else downloads, and
      // nosniff stops the browser second-guessing the type -- without this an
      // uploaded .html or .svg would execute on our own origin.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Keys are immutable, but the content is private to channel members.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
