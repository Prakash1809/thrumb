import { badRequest, notFound, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireChannelAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { messageInclude, toMessageDTO } from "@/lib/serialize";

type Params = { params: Promise<{ messageId: string }> };

/** The thread root plus every reply, oldest first. */
export const GET = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { messageId } = await params;

  const parent = await db.message.findUnique({ where: { id: messageId }, include: messageInclude });
  if (!parent) throw notFound("Message not found");
  if (parent.parentId) throw badRequest("That message is a reply, not a thread root");

  await requireChannelAccess(user.id, parent.channelId);

  const replies = await db.message.findMany({
    where: { parentId: messageId },
    include: messageInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });

  return Response.json({
    parent: toMessageDTO(parent),
    replies: replies.map((row) => toMessageDTO(row)),
  });
});
