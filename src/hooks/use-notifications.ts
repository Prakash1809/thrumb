"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSocketEvent } from "@/components/socket-provider";
import type { NotifyPayload } from "@/lib/events";

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

const STORAGE_KEY = "thrum:notifications-asked";

/**
 * Desktop notifications and the unread count in the tab title.
 *
 * The server decides *who* to notify (see lib/notify.ts); this hook only
 * decides how to show it. That split matters: the preference and mention rules
 * live in one place, and a muted channel costs the client nothing because the
 * event never arrives.
 *
 * Permission is never requested on load. A permission prompt on first paint is
 * the fastest way to get permanently denied, and `denied` cannot be undone from
 * script -- so it is requested only from an explicit user action, and the fact
 * that we have asked is remembered so the prompt is not re-offered forever.
 */
export function useNotifications({
  enabled,
  onOpen,
}: {
  /** False while the tab is the active one -- no point notifying what is visible. */
  enabled: boolean;
  onOpen: (payload: NotifyPayload) => void;
}) {
  const [permission, setPermission] = useState<NotificationPermissionState>("unsupported");
  const [unseen, setUnseen] = useState(0);
  const [alreadyAsked, setAlreadyAsked] = useState(true);

  // Held in a ref so the socket listener is bound once rather than on every
  // render of whatever is using this hook.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as NotificationPermissionState);

    try {
      setAlreadyAsked(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private mode or blocked storage: treat as asked, so we do not nag.
      setAlreadyAsked(true);
    }
  }, []);

  const request = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Not fatal; the prompt simply may be offered again.
    }
    setAlreadyAsked(true);

    const result = await Notification.requestPermission();
    setPermission(result as NotificationPermissionState);
  }, []);

  /** True when it is worth offering the enable-notifications prompt. */
  const shouldOfferPermission = permission === "default" && !alreadyAsked;

  useSocketEvent("notify", (payload) => {
    // The tab is in front and showing this channel: the message is already on
    // screen, and notifying would be noise.
    if (!enabled) return;

    setUnseen((n) => n + 1);

    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const title = payload.isDirect
      ? (payload.author.name ?? payload.author.username)
      : payload.isMention
        ? `${payload.author.name ?? payload.author.username} mentioned you in #${payload.channelLabel}`
        : `#${payload.channelLabel}`;

    try {
      const notification = new Notification(title, {
        body: payload.preview,
        // Collapses repeats from the same channel instead of stacking a tower
        // of them during a busy conversation.
        tag: `thrum:${payload.channelId}`,
        renotify: payload.isMention,
        icon: payload.author.image ?? undefined,
      } as NotificationOptions);

      notification.onclick = () => {
        window.focus();
        onOpenRef.current(payload);
        notification.close();
      };
    } catch {
      // Some browsers throw when constructing from a non-secure context.
    }
  });

  const clearUnseen = useCallback(() => setUnseen(0), []);

  return { permission, request, shouldOfferPermission, unseen, clearUnseen };
}

/**
 * Prefixes the tab title with an unread count.
 *
 * Restores the original on unmount, and reads it once rather than on every
 * change -- otherwise the prefix would accumulate into "(3) (2) (1) Thrum".
 */
export function useTitleBadge(count: number) {
  const baseTitle = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (baseTitle.current === null) {
      baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    }
    const base = baseTitle.current;
    document.title = count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
  }, [count]);

  useEffect(
    () => () => {
      if (typeof document !== "undefined" && baseTitle.current) {
        document.title = baseTitle.current;
      }
    },
    [],
  );
}
