import type { ChannelDTO } from "@/lib/events";

/**
 * Human label for a channel: the name for public/private, participant names
 * for DMs and groups.
 *
 * Lives here rather than in lib/serialize.ts because client components need it
 * and that module imports @prisma/client -- which would pull the whole Prisma
 * runtime into the browser bundle.
 */
export function channelLabel(
  channel: Pick<ChannelDTO, "type" | "name" | "counterparts">,
): string {
  if (channel.type === "PUBLIC" || channel.type === "PRIVATE") return channel.name ?? "channel";

  const names = channel.counterparts.map((u) => u.name ?? "Unknown");
  if (names.length === 0) return "You";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export function isNamedChannel(type: ChannelDTO["type"]): boolean {
  return type === "PUBLIC" || type === "PRIVATE";
}
