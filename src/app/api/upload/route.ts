import { badRequest, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { enforce } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES, saveUpload } from "@/lib/uploads";

/**
 * Two-step attachment flow: the file is stored here first, then its descriptor
 * is sent with the message. That keeps the message POST small and JSON-only,
 * and lets the composer show an upload progress row before anything is posted.
 *
 * The returned key is namespaced by workspace, and the message endpoint refuses
 * keys from another workspace.
 */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  // Uploads are the only endpoint that consumes unbounded disk, so this is the
  // limit that matters most for a public instance.
  await enforce("upload", user.id);

  const form = await req.formData().catch(() => {
    throw badRequest("Expected a multipart form upload");
  });

  const workspaceId = form.get("workspaceId");
  if (typeof workspaceId !== "string" || !workspaceId) throw badRequest("workspaceId is required");
  await requireWorkspaceMember(user.id, workspaceId);

  const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) throw badRequest("No file was uploaded");
  if (files.length > 10) throw badRequest("Attach at most 10 files at a time");

  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_UPLOAD_BYTES) {
    throw badRequest(`Total upload must be ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB or smaller`);
  }

  const saved = await Promise.all(files.map((file) => saveUpload(workspaceId, file)));

  return Response.json({ attachments: saved }, { status: 201 });
});
