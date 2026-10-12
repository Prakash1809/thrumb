import { route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { emitToUsers } from "@/lib/realtime";

type Params = { params: Promise<{ channelId: string }> };

/** Marks a channel read up to now. Called when the transcript is scrolled to the bottom. */
export const POST = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { channelId } = await params;
  await requireChannelAccess(user.id, channelId);

  const lastReadAt = new Date();
  await db.channelMember.update({
    where: { channelId_userId: { channelId, userId: user.id } },
    data: { lastReadAt },
  });

  // Other tabs belonging to this user should drop the badge too.
  emitToUsers([user.id])("read:update", {
    channelId,
    lastReadAt: lastReadAt.toISOString(),
  });

  return Response.json({ channelId, lastReadAt: lastReadAt.toISOString() });
});
