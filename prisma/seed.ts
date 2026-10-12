import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { dmKeyFor } from "../src/lib/dm";
import { mintInviteCode } from "../src/lib/invites";

const db = new PrismaClient();

/**
 * This script creates accounts whose password is published in the repository's
 * README. Running it against anything reachable hands those accounts to
 * whoever read the README, so it refuses to run in production unless the
 * operator very explicitly insists.
 */
if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "1") {
  console.error(
    [
      "Refusing to seed with NODE_ENV=production.",
      "",
      "This creates demo accounts with a password that is documented publicly.",
      "If you genuinely want them on this database, re-run with",
      "ALLOW_PRODUCTION_SEED=1 -- and change those passwords immediately.",
    ].join("\n"),
  );
  process.exit(1);
}

// Not in any common-password list, and long enough for the strength policy in
// lib/password.ts -- which the demo accounts should not be exempt from.
const DEMO_PASSWORD = "thrum-demo-9471";

const PEOPLE = [
  { email: "ada@thrum.dev", name: "Ada Lovelace", username: "ada" },
  { email: "grace@thrum.dev", name: "Grace Hopper", username: "grace" },
  { email: "alan@thrum.dev", name: "Alan Turing", username: "alan" },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const users = await Promise.all(
    PEOPLE.map((person) =>
      db.user.upsert({
        where: { email: person.email },
        create: { ...person, passwordHash },
        // Re-seeding resets the demo password, so a changed DEMO_PASSWORD takes
        // effect without needing the database dropped. The short usernames are
        // reasserted too, so @ada works even on a database seeded before
        // mentions existed (where the backfill produced "ada.lovelace").
        update: { name: person.name, username: person.username, passwordHash },
      }),
    ),
  );

  const [ada, grace, alan] = users;

  const workspace = await db.workspace.upsert({
    where: { slug: "acme" },
    create: { name: "Acme Engineering", slug: "acme" },
    update: {},
  });

  for (const [index, user] of users.entries()) {
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      create: {
        workspaceId: workspace.id,
        userId: user.id,
        role: index === 0 ? "OWNER" : "MEMBER",
      },
      update: {},
    });
  }

  async function ensureChannel(name: string, topic: string, isPrivate = false) {
    const existing = await db.channel.findFirst({ where: { workspaceId: workspace.id, name } });
    const channel =
      existing ??
      (await db.channel.create({
        data: {
          workspaceId: workspace.id,
          type: isPrivate ? "PRIVATE" : "PUBLIC",
          name,
          topic,
          createdById: ada.id,
        },
      }));

    for (const user of users) {
      await db.channelMember.upsert({
        where: { channelId_userId: { channelId: channel.id, userId: user.id } },
        create: { channelId: channel.id, userId: user.id },
        update: {},
      });
    }

    return channel;
  }

  const general = await ensureChannel("general", "Company-wide announcements and work-based matters");
  const engineering = await ensureChannel("engineering", "Builds, deploys and incident chatter");
  await ensureChannel("leadership", "Private channel for the leadership team", true);

  // A fresh invite on every run, so the join flow is always exercisable. Older
  // ones are revoked rather than left live.
  await db.workspaceInvite.updateMany({
    where: { workspaceId: workspace.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const { code, codeHash, codeHint } = mintInviteCode();
  await db.workspaceInvite.create({
    data: {
      workspaceId: workspace.id,
      codeHash,
      codeHint,
      role: "MEMBER",
      maxUses: 0,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdById: ada.id,
    },
  });

  const report = () => {
    console.log(`Seeded workspace "${workspace.name}".`);
    console.log(`Sign in as any of: ${PEOPLE.map((p) => p.email).join(", ")}`);
    console.log(`Password: ${DEMO_PASSWORD}`);
    console.log(`Fresh invite link: /join/${code}`);
    console.log("(The code is printed once -- only its digest is stored.)");
  };

  // Seeding is idempotent, so bail out of message creation on a re-run rather
  // than stacking duplicate transcripts.
  const alreadySeeded = await db.message.findFirst({ where: { channelId: general.id } });
  if (alreadySeeded) {
    console.log("Transcript already present; refreshed accounts and invite only.");
    report();
    return;
  }

  const now = Date.now();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000);

  const welcome = await db.message.create({
    data: {
      workspaceId: workspace.id,
      channelId: general.id,
      userId: ada.id,
      body: "Welcome to Acme Engineering. This channel is for anything that concerns everyone.",
      createdAt: minutesAgo(240),
    },
  });

  await db.message.create({
    data: {
      workspaceId: workspace.id,
      channelId: general.id,
      userId: grace.id,
      body: "Glad to be here. I will post the on-call rota in #engineering shortly.",
      createdAt: minutesAgo(236),
    },
  });

  await db.reaction.createMany({
    data: [
      { messageId: welcome.id, userId: grace.id, emoji: "👍" },
      { messageId: welcome.id, userId: alan.id, emoji: "🎉" },
    ],
    skipDuplicates: true,
  });

  const deploy = await db.message.create({
    data: {
      workspaceId: workspace.id,
      channelId: engineering.id,
      userId: alan.id,
      body: "Deploy 2.14 is out. Latency on the search endpoint dropped from 420ms to 90ms.",
      createdAt: minutesAgo(90),
    },
  });

  const replies = [
    { user: grace, body: "That is the index change landing. Nice.", at: 86 },
    { user: ada, body: "Can we get the same treatment on the channel list query?", at: 84 },
    { user: alan, body: "Already keyset paginated. Next up is the unread count.", at: 80 },
  ];

  for (const reply of replies) {
    await db.message.create({
      data: {
        workspaceId: workspace.id,
        channelId: engineering.id,
        userId: reply.user.id,
        parentId: deploy.id,
        body: reply.body,
        createdAt: minutesAgo(reply.at),
      },
    });
  }

  await db.message.update({
    where: { id: deploy.id },
    data: { replyCount: replies.length, lastReplyAt: minutesAgo(80) },
  });

  await db.channel.update({
    where: { id: engineering.id },
    data: { lastMessageAt: minutesAgo(80) },
  });

  // A DM between the first two people, so the sidebar has one on first load.
  const participants = [ada.id, grace.id].sort();
  const dmKey = dmKeyFor(workspace.id, participants);
  const dm =
    (await db.channel.findUnique({ where: { dmKey } })) ??
    (await db.channel.create({
      data: {
        workspaceId: workspace.id,
        type: "DM",
        dmKey,
        createdById: ada.id,
        lastMessageAt: minutesAgo(12),
        members: { create: participants.map((userId) => ({ userId })) },
      },
    }));

  await db.message.create({
    data: {
      workspaceId: workspace.id,
      channelId: dm.id,
      userId: grace.id,
      body: "Do you have five minutes to look at the incident timeline before standup?",
      createdAt: minutesAgo(12),
    },
  });

  report();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
