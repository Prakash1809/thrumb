import { notFound, redirect } from "next/navigation";

import { ChannelView } from "@/components/channel-view";
import { currentUser } from "@/lib/auth";
import { requireChannelAccess } from "@/lib/authz";
import { channelLabel } from "@/lib/channel-label";
import { getChannelDTO } from "@/lib/channels";

type Props = { params: Promise<{ workspaceId: string; channelId: string }> };

export async function generateMetadata({ params }: Props) {
  const { channelId } = await params;
  const user = await currentUser();
  if (!user) return { title: "Thrum" };

  try {
    const channel = await getChannelDTO(user.id, channelId);
    const label = channelLabel(channel);
    return {
      title: `${channel.type === "PUBLIC" || channel.type === "PRIVATE" ? `#${label}` : label} · Thrum`,
    };
  } catch {
    return { title: "Thrum" };
  }
}

export default async function ChannelPage({ params }: Props) {
  const { workspaceId, channelId } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/w/${workspaceId}/c/${channelId}`);

  // Also auto-joins public channels, which is what makes a link to a channel
  // you have not opened before just work. A refusal is a 404 either way, so
  // probing ids reveals nothing.
  const access = await requireChannelAccess(user.id, channelId).catch(() => null);
  if (!access || access.channel.workspaceId !== workspaceId) notFound();

  const channel = await getChannelDTO(user.id, channelId);

  return <ChannelView channel={channel} />;
}
