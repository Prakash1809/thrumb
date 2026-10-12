import type { DefaultEventsMap, Server } from "socket.io";

import type { ClientToServerEvents, ServerToClientEvents } from "@/lib/events";
import { roomFor } from "@/lib/events";

/** Attached to every socket after the handshake authenticates it. */
export type SocketData = { userId: string };

export type IOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SocketData
>;

// server.ts creates the Socket.IO server in the same process as the Next.js
// request handler and parks it here, so route handlers can broadcast without a
// second transport hop. In dev, module reloads do not clear it.
const globalForIO = globalThis as unknown as { __thrumIO?: IOServer };

export function setIO(io: IOServer) {
  globalForIO.__thrumIO = io;
}

/**
 * Returns the live Socket.IO server, or null when none is attached (e.g. a
 * script or test importing a route handler directly). Callers must treat a
 * failed broadcast as non-fatal: the write already committed, and the client
 * will see it on next fetch.
 */
export function getIO(): IOServer | null {
  return globalForIO.__thrumIO ?? null;
}

type Emit = <E extends keyof ServerToClientEvents>(
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) => void;

export const emitToChannel: (channelId: string) => Emit = (channelId) => (event, ...args) => {
  getIO()?.to(roomFor.channel(channelId)).emit(event, ...args);
};

export const emitToWorkspace: (workspaceId: string) => Emit = (workspaceId) => (event, ...args) => {
  getIO()?.to(roomFor.workspace(workspaceId)).emit(event, ...args);
};

export const emitToUsers: (userIds: string[]) => Emit = (userIds) => (event, ...args) => {
  const io = getIO();
  if (!io || userIds.length === 0) return;
  io.to(userIds.map(roomFor.user)).emit(event, ...args);
};

/** Pushes every socket belonging to these users into a channel room. */
export async function addUsersToChannelRoom(channelId: string, userIds: string[]) {
  const io = getIO();
  if (!io || userIds.length === 0) return;
  const sockets = await io.in(userIds.map(roomFor.user)).fetchSockets();
  for (const socket of sockets) socket.join(roomFor.channel(channelId));
}

/**
 * Drops these users' sockets out of a channel room. Without this, someone who
 * leaves a channel keeps receiving its messages until they reconnect.
 */
export async function removeUsersFromChannelRoom(channelId: string, userIds: string[]) {
  const io = getIO();
  if (!io || userIds.length === 0) return;
  const sockets = await io.in(userIds.map(roomFor.user)).fetchSockets();
  for (const socket of sockets) socket.leave(roomFor.channel(channelId));
}
