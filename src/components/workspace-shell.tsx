"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CloseIcon, SearchIcon } from "@/components/icons";
import { InviteDialog } from "@/components/invite-dialog";
import { MembersDialog } from "@/components/members-dialog";
import { NewChannelDialog } from "@/components/new-channel-dialog";
import { NewDmDialog } from "@/components/new-dm-dialog";
import { NotificationBanner } from "@/components/notification-banner";
import { SearchDialog } from "@/components/search-dialog";
import { Sidebar } from "@/components/sidebar";
import { useWorkspace } from "@/components/workspace-provider";
import { useNotifications, useTitleBadge } from "@/hooks/use-notifications";

type Dialog = "search" | "channel" | "dm" | "invite" | "members" | null;

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { workspace, activeChannelId, totalUnreadMentions } = useWorkspace();

  const [dialog, setDialog] = useState<Dialog>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  /**
   * Notifications are suppressed for whatever is on screen in a focused tab --
   * notifying someone about a message they are looking at is pure noise.
   */
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const onVisibility = () => setTabVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const activeRef = useRef(activeChannelId);
  activeRef.current = activeChannelId;

  const { permission, request, shouldOfferPermission, unseen, clearUnseen } = useNotifications({
    // A notification is worth showing unless the tab is focused *and* already
    // showing that conversation; the hook receives the decision, not the state.
    enabled: true,
    onOpen: (payload) => {
      router.push(`/w/${payload.workspaceId}/c/${payload.channelId}`);
    },
  });

  // The title badge counts unread mentions, which is the durable signal --
  // desktop notifications can be denied or missed, a tab title cannot.
  useTitleBadge(totalUnreadMentions);

  // Returning to the tab means they have seen what was waiting.
  useEffect(() => {
    if (tabVisible) clearUnseen();
  }, [tabVisible, clearUnseen, unseen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd+K for search, the shortcut people already have in their hands.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialog((current) => (current === "search" ? null : "search"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      {/* Desktop rail */}
      <div className="hidden lg:block">
        <Sidebar
          onOpenSearch={() => setDialog("search")}
          onNewChannel={() => setDialog("channel")}
          onNewDm={() => setDialog("dm")}
          onInvite={() => setDialog("invite")}
          onOpenMembers={() => setDialog("members")}
        />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="relative z-10">
            <Sidebar
              onOpenSearch={() => {
                setDrawerOpen(false);
                setDialog("search");
              }}
              onNewChannel={() => {
                setDrawerOpen(false);
                setDialog("channel");
              }}
              onNewDm={() => {
                setDrawerOpen(false);
                setDialog("dm");
              }}
              onInvite={() => {
                setDrawerOpen(false);
                setDialog("invite");
              }}
              onOpenMembers={() => {
                setDrawerOpen(false);
                setDialog("members");
              }}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            className="focus-ring absolute top-3 right-3 z-20 rounded-md bg-[var(--color-surface)] p-2 shadow-lg"
            onClick={() => setDrawerOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {shouldOfferPermission && !bannerDismissed && (
          <NotificationBanner
            onEnable={() => void request()}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-line)] px-3 py-2 lg:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            className="focus-ring rounded-md p-1.5 hover:bg-[var(--color-surface-2)]"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-current">
              <path d="M2 3.75h12v1.5H2zm0 4h12v1.5H2zm0 4h12v1.5H2z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Search"
            className="focus-ring ml-auto rounded-md p-1.5 hover:bg-[var(--color-surface-2)]"
            onClick={() => setDialog("search")}
          >
            <SearchIcon />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">{children}</div>
      </main>

      {dialog === "search" && <SearchDialog onClose={() => setDialog(null)} />}
      {dialog === "channel" && <NewChannelDialog onClose={() => setDialog(null)} />}
      {dialog === "dm" && <NewDmDialog onClose={() => setDialog(null)} />}
      {dialog === "invite" && <InviteDialog onClose={() => setDialog(null)} />}
      {dialog === "members" && <MembersDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
