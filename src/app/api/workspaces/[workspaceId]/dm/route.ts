import { Prisma } from "@prisma/client";

import { badRequest, readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { db } from "@/lib/db";
import { dmChannelType, dmKeyFor } from "@/lib/dm";
import { addUsersToChannelRoom, emitToUsers } from "@/lib/realtime";
import { toChannelDTO, userSelect } from "@/lib/serialize";
import { openDmSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string }> };

const channelSelect = {
  id: true,
  workspaceId: true,
  type: true,
  name: true,
  topic: true,
  lastMessageAt: true,
  members: { select: { userId: true, lastReadAt: true, user: { select: userSelect } } },
} satisfies Prisma.ChannelSelect;

/**
 * Opens (or re-opens) a DM / group DM. Idempotent: the participant set maps to
 * a single dmKey, so clicking a name twice returns the same channel rather than
 * creating a second conversation.
 */
export const POST = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const { userIds } = openDmSchema.parse(await readJson(req));
  const participants = [...new Set([user.id, ...userIds])].sort();

  // Everyone in the conversation must be in the workspace, or a DM would leak
  // workspace content to an outsider.
  const verified = await db.workspaceMember.findMany({
    where: { workspaceId, userId: { in: participants } },
    select: { userId: true },
  });
  if (verified.length !== participants.length) {
    throw badRequest("Everyone in a DM must be a member of this workspace");
  }

  const dmKey = dmKeyFor(workspaceId, participants);

  const existing = await db.channel.findUnique({ where: { dmKey }, select: channelSelect });
  if (existing) {
    return Response.json({ channel: toChannelDTO(existing, user.id) });
  }

  const channel = await db.channel
    .create({
      data: {
        workspaceId,
        type: dmChannelType(participants.length),
        dmKey,
        createdById: user.id,
        members: { create: participants.map((userId) => ({ userId })) },
      },
      select: channelSelect,
    })
    // The unique index on dmKey is the real guard against two people opening
    // the same DM at once; whoever loses the race just reads the winner's row.
    .catch(async () => db.channel.findUniqueOrThrow({ where: { dmKey }, select: channelSelect }));

  const dto = toChannelDTO(channel, user.id);

  // Put every participant's live sockets in the room and show it in their
  // sidebar immediately, before anyone has sent a message.
  await addUsersToChannelRoom(channel.id, participants);
  for (const participantId of participants) {
    emitToUsers([participantId])("channel:upsert", toChannelDTO(channel, participantId));
  }

  return Response.json({ channel: dto }, { status: 201 });
});
