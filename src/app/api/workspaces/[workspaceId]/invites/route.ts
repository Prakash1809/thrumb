import { readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { mintInviteCode } from "@/lib/invites";
import { enforce } from "@/lib/rate-limit";
import { createInviteSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string }> };

/** Active invites for a workspace. Admins only; codes are never returned. */
export const GET = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceAdmin(user.id, workspaceId);

  const invites = await db.workspaceInvite.findMany({
    where: { workspaceId, revokedAt: null },
    select: {
      id: true,
      codeHint: true,
      role: true,
      maxUses: true,
      uses: true,
      expiresAt: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({ invites });
});

/**
 * Mints an invite. The code is returned here and nowhere else -- only its
 * digest is stored, so this response is the single opportunity to copy it.
 */
export const POST = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;

  // Only admins and owners can widen access to a workspace.
  await requireWorkspaceAdmin(user.id, workspaceId);
  await enforce("createInvite", user.id);

  const { maxUses, expiresInHours, role } = createInviteSchema.parse(await readJson(req));
  const { code, codeHash, codeHint } = mintInviteCode();

  const invite = await db.workspaceInvite.create({
    data: {
      workspaceId,
      codeHash,
      codeHint,
      role,
      maxUses,
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      createdById: user.id,
    },
    select: { id: true, expiresAt: true, maxUses: true, role: true },
  });

  return Response.json({ invite, code }, { status: 201 });
});
