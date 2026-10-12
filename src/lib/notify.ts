import type { ChannelType, NotificationLevel } from "@prisma/client";

import { db } from "@/lib/db";
import type { NotifyPayload, UserSummary } from "@/lib/events";
import { parseMentions } from "@/lib/mentions";
import { isOnline } from "@/lib/presence";
import { emitToUsers } from "@/lib/realtime";

/**
 * Who gets told about a message, and why.
 *
 * This decision is made once, on the server, rather than broadcast to everyone
 * and filtered client-side. Two reasons: a muted channel should cost a client
 * nothing, and notification rules are the kind of thing that drifts out of
 * sync the moment two implementations exist.
 *
 * Precedence, highest first:
 *   1. Never notify the author about their own message.
 *   2. A per-channel preference overrides the workspace default.
 *   3. NONE means silent even for a direct mention -- an explicit mute is a
 *      stronger signal than someone else's decision to name you.
 *   4. A DM is always treated as a mention: there is no ambient traffic in a
 *      two-person conversation, so everything in it is addressed to you.
 */

const PREVIEW_LENGTH = 140;

export type MentionResolution = {
  /** Users explicitly named, resolved from @handles to ids. */
  mentionedUserIds: string[];
  channelWide: boolean;
  hereOnly: boolean;
};

/**
 * Resolves @handles in a body to user ids, restricted to members of the
 * channel.
 *
 * Restricting to members is deliberate: naming someone who cannot read the
 * channel would either notify them about content they have no access to, or
 * create a mention row pointing at a message they cannot open. Both are worse
 * than the mention silently not resolving.
 */
export async function resolveMentions(
  body: string,
  channelId: string,
): Promise<MentionResolution> {
  const parsed = parseMentions(body);

  if (parsed.usernames.length === 0) {
    return { mentionedUserIds: [], channelWide: parsed.channelWide, hereOnly: parsed.hereOnly };
  }

  const rows = await db.channelMember.findMany({
    where: {
      channelId,
      user: { username: { in: parsed.usernames }, deactivatedAt: null },
    },
    select: { userId: true },
  });

  return {
    mentionedUserIds: rows.map((r) => r.userId),
    channelWide: parsed.channelWide,
    hereOnly: parsed.hereOnly,
  };
}

type Recipient = { userId: string; level: NotificationLevel; isMention: boolean };

/**
 * Decides the audience and delivers `notify` to each of them.
 *
 * Returns the ids that were notified, which the caller uses for nothing but
 * logging -- delivery is best effort, because a missed desktop notification is
 * recoverable (the unread badge is the durable signal) and must never fail a
 * message that has already been written.
 */
export async function deliverNotifications({
  message,
  channel,
  author,
  mentions,
}: {
  message: { id: string; body: string };
  channel: {
    id: string;
    workspaceId: string;
    type: ChannelType;
    name: string | null;
  };
  author: UserSummary;
  mentions: MentionResolution;
}): Promise<void> {
  const isDirect = channel.type === "DM" || channel.type === "GROUP";

  const [members, prefs] = await Promise.all([
    db.channelMember.findMany({
      where: { channelId: channel.id, userId: { not: author.id } },
      select: { userId: true },
    }),
    db.notificationPref.findMany({
      where: {
        workspaceId: channel.workspaceId,
        OR: [{ channelId: channel.id }, { channelId: null }],
      },
      select: { userId: true, channelId: true, level: true },
    }),
  ]);

  if (members.length === 0) return;

  // Per-channel row wins over the workspace-wide default.
  const channelPref = new Map<string, NotificationLevel>();
  const workspacePref = new Map<string, NotificationLevel>();
  for (const pref of prefs) {
    if (pref.channelId === channel.id) channelPref.set(pref.userId, pref.level);
    else workspacePref.set(pref.userId, pref.level);
  }

  const mentioned = new Set(mentions.mentionedUserIds);

  const candidates: Recipient[] = members.map(({ userId }) => {
    const level = channelPref.get(userId) ?? workspacePref.get(userId) ?? "MENTIONS";
    const isMention = isDirect || mentioned.has(userId) || mentions.channelWide || mentions.hereOnly;
    return { userId, level, isMention };
  });

  // @here reaches only people currently connected. Resolved here rather than
  // on the client so an offline member is not woken by a stale notification
  // when they next connect.
  const hereFiltered = await Promise.all(
    candidates.map(async (candidate) => {
      if (!mentions.hereOnly) return candidate;
      if (mentioned.has(candidate.userId) || mentions.channelWide) return candidate;
      return (await isOnline(candidate.userId)) ? candidate : null;
    }),
  );

  const recipients = hereFiltered.filter((c): c is Recipient => {
    if (!c) return false;
    if (c.level === "NONE") return false;
    if (c.level === "ALL") return true;
    return c.isMention;
  });

  if (recipients.length === 0) return;

  const label = channel.name ?? author.name ?? author.username;
  const preview =
    message.body.length > PREVIEW_LENGTH
      ? `${message.body.slice(0, PREVIEW_LENGTH).trimEnd()}…`
      : message.body || "Sent an attachment";

  // Grouped by whether it was a mention, so the payload can say so without a
  // per-recipient emit for identical content.
  for (const group of [true, false]) {
    const ids = recipients.filter((r) => r.isMention === group).map((r) => r.userId);
    if (ids.length === 0) continue;

    const payload: NotifyPayload = {
      messageId: message.id,
      channelId: channel.id,
      workspaceId: channel.workspaceId,
      channelLabel: label,
      isDirect,
      isMention: group,
      author,
      preview,
    };

    emitToUsers(ids)("notify", payload);
  }
}

/** Persists mention rows and pushes the new badge counts. */
export async function recordMentions({
  messageId,
  channelId,
  workspaceId,
  authorId,
  mentionedUserIds,
}: {
  messageId: string;
  channelId: string;
  workspaceId: string;
  authorId: string;
  mentionedUserIds: string[];
}): Promise<void> {
  // @channel and @here are intentionally not persisted as mention rows. They
  // are a notification, not a to-do: a broadcast would otherwise leave every
  // member with an unread-mention badge they cannot meaningfully clear.
  const targets = mentionedUserIds.filter((id) => id !== authorId);
  if (targets.length === 0) return;

  await db.mention.createMany({
    data: targets.map((userId) => ({ messageId, userId, channelId, workspaceId })),
    skipDuplicates: true,
  });

  const counts = await db.mention.groupBy({
    by: ["userId"],
    where: { userId: { in: targets }, channelId, readAt: null },
    _count: { _all: true },
  });

  for (const row of counts) {
    emitToUsers([row.userId])("mentions:update", {
      channelId,
      unreadMentions: row._count._all,
    });
  }
}
