"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import type { ClientToServerEvents, ServerToClientEvents } from "@/lib/events";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type SocketState = {
  socket: AppSocket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketState>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SocketState>({ socket: null, connected: false });

  useEffect(() => {
    // One socket per tab, same origin as the page. The handshake carries the
    // session cookie, which server.ts decodes -- no token plumbing here.
    const socket: AppSocket = io({
      path: "/socket.io",
      withCredentials: true,
      // Websocket first; polling stays as a fallback for restrictive proxies.
      transports: ["websocket", "polling"],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });

    const onConnect = () => setState({ socket, connected: true });
    const onDisconnect = () => setState({ socket, connected: false });

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    setState({ socket, connected: socket.connected });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.close();
    };
  }, []);

  return <SocketContext.Provider value={state}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketState {
  return useContext(SocketContext);
}

/**
 * Subscribes to one server event for the lifetime of the component.
 *
 * The handler is held in a ref so a listener is bound once per socket rather
 * than re-bound on every render. Without this, any component that reads state
 * inside its handler would detach and reattach on each keystroke elsewhere in
 * the tree, and events arriving in that window would be dropped.
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E],
) {
  const { socket } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!socket) return;

    const listener = (...args: unknown[]) => {
      (ref.current as (...a: unknown[]) => void)(...args);
    };

    // socket.io wraps listener types in a conditional (FallbackToUntypedListener)
    // that TypeScript cannot resolve while E is still an unbound generic. The
    // cast is confined to these two calls; callers of useSocketEvent keep the
    // precise per-event signature from ServerToClientEvents.
    const untyped = socket as unknown as {
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      off: (event: string, listener: (...args: unknown[]) => void) => void;
    };

    untyped.on(event as string, listener);
    return () => untyped.off(event as string, listener);
  }, [socket, event]);
}
