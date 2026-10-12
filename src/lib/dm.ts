/**
 * A DM/group channel has no name, so it is identified by a stable fingerprint
 * of its participants. Sorting the ids makes the key order-independent, and
 * the unique index on Channel.dmKey means two people opening the same DM at the
 * same moment converge on one channel instead of racing two into existence.
 */
export function dmKeyFor(workspaceId: string, userIds: string[]): string {
  const unique = [...new Set(userIds)].sort();
  return `${workspaceId}:${unique.join(",")}`;
}

export function dmChannelType(memberCount: number): "DM" | "GROUP" {
  return memberCount <= 2 ? "DM" : "GROUP";
}
