import { readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess, requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { notificationPrefSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string }> };

/** The viewer's notification settings for a workspace. */
export const GET = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const prefs = await db.notificationPref.findMany({
    where: { userId: user.id, workspaceId },
    select: { channelId: true, level: true },
  });

  return Response.json({
    // MENTIONS is the default for anyone who has never chosen: notifying on
    // every message in every channel is how people end up muting everything.
    workspaceDefault: prefs.find((p) => p.channelId === null)?.level ?? "MENTIONS",
    channels: prefs
      .filter((p) => p.channelId !== null)
      .map((p) => ({ channelId: p.channelId as string, level: p.level })),
  });
});

/** Sets the workspace default (channelId null) or one channel's override. */
export const PUT = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const { channelId, level } = notificationPrefSchema.parse(await readJson(req));

  // A per-channel preference is only meaningful for a channel the viewer can
  // read; without this check it would be a way to confirm a channel id exists.
  if (channelId) await requireChannelAccess(user.id, channelId);

  /**
   * findFirst-then-write rather than upsert.
   *
   * The workspace-wide row is identified by a NULL channelId, and Prisma's
   * compound-unique `where` input cannot express null -- so upsert is simply
   * not available for this key. The unique index still protects the invariant
   * in the database; the catch below turns the race between two tabs toggling
   * the same switch into the update it should have been.
   */
  const existing = await db.notificationPref.findFirst({
    where: { userId: user.id, workspaceId, channelId },
    select: { id: true },
  });

  if (existing) {
    await db.notificationPref.update({ where: { id: existing.id }, data: { level } });
  } else {
    try {
      await db.notificationPref.create({
        data: { userId: user.id, workspaceId, channelId, level },
      });
    } catch {
      // Lost the insert race; the row now exists, so apply the level to it.
      const row = await db.notificationPref.findFirst({
        where: { userId: user.id, workspaceId, channelId },
        select: { id: true },
      });
      if (row) await db.notificationPref.update({ where: { id: row.id }, data: { level } });
    }
  }

  return Response.json({ channelId, level });
});
