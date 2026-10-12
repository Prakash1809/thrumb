import { conflict, readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceMember } from "@/lib/authz";
import { listChannelsForUser } from "@/lib/channels";
import { db } from "@/lib/db";
import { enforce } from "@/lib/rate-limit";
import { emitToUsers, emitToWorkspace } from "@/lib/realtime";
import { toChannelDTO, userSelect } from "@/lib/serialize";
import { createChannelSchema } from "@/lib/validation";

type Params = { params: Promise<{ workspaceId: string }> };

export const GET = route(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  return Response.json(await listChannelsForUser(user.id, workspaceId));
});

export const POST = route(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  await enforce("createResource", user.id);

  const { workspaceId } = await params;
  await requireWorkspaceMember(user.id, workspaceId);

  const { name, topic, isPrivate } = createChannelSchema.parse(await readJson(req));

  const taken = await db.channel.findFirst({
    where: { workspaceId, name },
    select: { id: true },
  });
  if (taken) throw conflict(`#${name} already exists`);

  const channel = await db.channel.create({
    data: {
      workspaceId,
      type: isPrivate ? "PRIVATE" : "PUBLIC",
      name,
      topic: topic?.trim() || null,
      createdById: user.id,
      members: { create: { userId: user.id } },
    },
    select: {
      id: true,
      workspaceId: true,
      type: true,
      name: true,
      topic: true,
      lastMessageAt: true,
      members: { select: { userId: true, lastReadAt: true, user: { select: userSelect } } },
    },
  });

  const dto = toChannelDTO(channel, user.id);

  // A public channel belongs in everyone's browse list; a private one is only
  // visible to its single member so far.
  if (dto.type === "PUBLIC") emitToWorkspace(workspaceId)("channel:upsert", dto);
  else emitToUsers([user.id])("channel:upsert", dto);

  return Response.json({ channel: dto }, { status: 201 });
});
