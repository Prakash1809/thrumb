import { createServer } from "node:http";

import { decode } from "@auth/core/jwt";
import next from "next";
import { Server, type DefaultEventsMap } from "socket.io";

import { db } from "./src/lib/db";
import type { ClientToServerEvents, ServerToClientEvents } from "./src/lib/events";
import { roomFor } from "./src/lib/events";
import { CLIENT_IP_HEADER } from "./src/lib/rate-limit";
import { setIO, type IOServer, type SocketData } from "./src/lib/realtime";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = Number(process.env.PORT ?? 3000);
const hstsEnabled = !dev && process.env.ENABLE_HSTS === "1";

const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  console.error("AUTH_SECRET is not set. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

/**
 * Auth.js derives the JWT encryption key from the cookie name, so the salt we
 * pass to decode has to match the cookie we read it from.
 */
const COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/** Returns the signed-in user id for a handshake, or null to reject it. */
async function userIdFromCookies(cookieHeader: string | undefined): Promise<string | null> {
  const cookies = parseCookies(cookieHeader);
  for (const salt of COOKIE_NAMES) {
    const token = cookies[salt];
    if (!token) continue;
    try {
      const payload = await decode({ token, secret: AUTH_SECRET!, salt });
      if (payload?.sub) return payload.sub;
    } catch {
      // Wrong salt for this cookie, or a tampered/expired token. Try the next.
    }
  }
  return null;
}

/**
 * userId -> live socket ids. A user with three tabs open counts as one online
 * person, and only the first connect / last disconnect moves presence.
 */
const presence = new Map<string, Set<string>>();

/**
 * Client-driven socket events allowed per socket: a burst of this many, then a
 * steady trickle. Real typing produces one event every few seconds, so these
 * are generous for a person and restrictive for a loop.
 */
const SOCKET_EVENT_BURST = 40;
const SOCKET_EVENT_REFILL = 8;

/**
 * Origins permitted to open a socket in development.
 *
 * `origin: true` reflects whatever Origin the request carried, which combined
 * with credentials is the websocket equivalent of `Access-Control-Allow-Origin:
 * *` with cookies. SameSite=Lax already stops the cookie riding along on a
 * cross-site handshake, but an explicit allowlist does not depend on that.
 * In production the option is omitted entirely, which is Socket.IO's
 * same-origin-only default.
 */
const DEV_SOCKET_ORIGINS = [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  `http://[::1]:${port}`,
];

async function main() {
  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();

  const httpServer = createServer((req, res) => {
    /**
     * Stamp the real TCP peer address for the rate limiter.
     *
     * Deleting any inbound copy first is the whole point: a client that could
     * set this header itself would be able to present a different identity on
     * every request and bypass every per-address limit. Overwriting it here
     * means route handlers have one address they can actually trust, with no
     * reverse proxy required. See lib/rate-limit.ts.
     */
    delete req.headers[CLIENT_IP_HEADER];
    const peer = req.socket.remoteAddress;
    if (peer) req.headers[CLIENT_IP_HEADER] = peer;

    /**
     * HSTS lives here, not in next.config.ts, because that file's headers()
     * runs at build time -- a runtime flag checked there never takes effect.
     * Here it is read per request, by Node, so `ENABLE_HSTS=1 npm start` works.
     *
     * Off by default: sending it over plain HTTP would pin a developer's
     * browser to https://localhost, and it is meaningless without TLS. Turn it
     * on once the deployment actually terminates TLS.
     */
    if (hstsEnabled) {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }

    handle(req, res).catch((err) => {
      console.error("[next]", err);
      res.statusCode = 500;
      res.end("Internal server error");
    });
  });

  const io: IOServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    DefaultEventsMap,
    SocketData
  >(httpServer, {
    path: "/socket.io",
    // Attachments go through /api/upload; sockets only carry small JSON.
    maxHttpBufferSize: 1e6,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    cors: dev ? { origin: DEV_SOCKET_ORIGINS, credentials: true } : undefined,
  });

  // Reject unauthenticated handshakes here rather than per event, so no socket
  // in a room is ever anonymous.
  io.use(async (socket, nextFn) => {
    const userId = await userIdFromCookies(socket.request.headers.cookie);
    if (!userId) return nextFn(new Error("unauthorized"));
    socket.data.userId = userId;
    nextFn();
  });

  io.on("connection", async (socket) => {
    const { userId } = socket.data;

    socket.join(roomFor.user(userId));

    // Pre-join every workspace and channel the user belongs to, so a message
    // posted anywhere they can see reaches them without a client round trip.
    // The display name comes along now so typing events need no query later.
    const [workspaces, channels, profile] = await Promise.all([
      db.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
      db.channelMember.findMany({ where: { userId }, select: { channelId: true } }),
      db.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);

    const displayName = profile?.name ?? null;

    for (const { workspaceId } of workspaces) socket.join(roomFor.workspace(workspaceId));
    for (const { channelId } of channels) socket.join(roomFor.channel(channelId));

    const workspaceIds = workspaces.map((w) => w.workspaceId);

    // Presence is only meaningful between people who share a workspace, so the
    // audience for both the sync and the broadcast is those workspace rooms.
    const sockets = presence.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socket.id);
    presence.set(userId, sockets);

    if (wasOffline && workspaceIds.length > 0) {
      io.to(workspaceIds.map(roomFor.workspace)).emit("presence:update", { userId, online: true });
    }

    if (workspaceIds.length > 0) {
      const peers = await db.workspaceMember.findMany({
        where: { workspaceId: { in: workspaceIds } },
        select: { userId: true },
        distinct: ["userId"],
      });
      const online = peers.map((p) => p.userId).filter((id) => presence.has(id));
      socket.emit("presence:sync", online);
    } else {
      socket.emit("presence:sync", [userId]);
    }

    /**
     * Per-socket budget for client-driven events.
     *
     * Without this, a client can emit in a loop and we happily do the work --
     * and `channel:subscribe` does a database read each time, which turns a
     * trivial script into a database denial of service. A simple refilling
     * budget costs nothing and bounds it.
     */
    let budget = SOCKET_EVENT_BURST;
    const refill = setInterval(() => {
      budget = Math.min(SOCKET_EVENT_BURST, budget + SOCKET_EVENT_REFILL);
    }, 1000);

    const spend = (): boolean => {
      if (budget <= 0) return false;
      budget -= 1;
      return true;
    };

    // A channel created after connect (a new DM, a channel someone just made)
    // needs an explicit subscribe. Membership is re-checked, never trusted.
    socket.on("channel:subscribe", async (channelId) => {
      if (typeof channelId !== "string" || channelId.length > 64) return;
      if (!spend()) return;

      const member = await db.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId } },
        select: { id: true },
      });
      if (member) socket.join(roomFor.channel(channelId));
    });

    socket.on("channel:unsubscribe", (channelId) => {
      if (typeof channelId !== "string" || !spend()) return;
      socket.leave(roomFor.channel(channelId));
    });

    /**
     * Typing is ephemeral and never persisted.
     *
     * The display name is read once at connect rather than per event: this
     * fires several times a minute per typist, and a database round trip on an
     * event a client controls the rate of is exactly the wrong shape.
     *
     * Relay is restricted to rooms this socket has already joined, and joining
     * went through a membership check, so this cannot be used to probe or
     * broadcast into a channel the user is not in.
     */
    const relayTyping = (event: "typing" | "typing:stop", channelId: unknown) => {
      if (typeof channelId !== "string" || channelId.length > 64) return;
      if (!socket.rooms.has(roomFor.channel(channelId))) return;
      if (!spend()) return;

      socket.to(roomFor.channel(channelId)).emit(event, { channelId, userId, name: displayName });
    };

    socket.on("typing:start", (channelId) => relayTyping("typing", channelId));
    socket.on("typing:stop", (channelId) => relayTyping("typing:stop", channelId));

    socket.on("disconnect", () => {
      clearInterval(refill);

      const live = presence.get(userId);
      if (!live) return;
      live.delete(socket.id);
      if (live.size > 0) return;

      presence.delete(userId);
      if (workspaceIds.length > 0) {
        io.to(workspaceIds.map(roomFor.workspace)).emit("presence:update", { userId, online: false });
      }
    });
  });

  // Hand the server to the Next.js route handlers, which run in this same
  // process and broadcast through it after a write commits.
  setIO(io);

  httpServer.listen(port, () => {
    console.log(`  Thrum ready on http://${hostname}:${port}  (realtime: /socket.io)`);
  });

  const shutdown = async () => {
    console.log("\n  shutting down...");
    io.close();
    httpServer.close();
    await db.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
