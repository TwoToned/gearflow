"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";
import { useNotificationsFeed } from "@/hooks/use-notifications-feed";
import { useNotificationDismissals } from "@/hooks/use-notification-dismissals";
import { useNotifications } from "@/hooks/use-notifications";
import { mergeShellFeed, selectVisibleNotifications, type ShellNotice } from "@/lib/notification-feed";
import { showError } from "@/lib/show-error";

const UNDO_MS = 8000;

export interface ShellFeed {
  items: ShellNotice[];
  unreadCount: number;
  /** Opening a stored mention marks it read; a derived row has nothing to mark. */
  open: (notice: ShellNotice) => Promise<void>;
  /** Marks everything read (stored mentions read + derived rows dismissed), toasts with Undo. */
  markAllRead: () => Promise<void>;
}

/**
 * ONE feed for the bell (D70): the derived org-wide scan (minus this user's
 * dismissals — the same `selectVisibleNotifications` `/notifications` uses) merged
 * with the stored mentions. `markAllRead`'s toast Undo calls the exact reverse
 * writes for the exact ids it touched, so a row the user had already read before
 * is never resurrected.
 */
export function useShellFeed(): ShellFeed {
  const { data: org } = useActiveOrganization();
  const { data: derived } = useNotificationsFeed(org?.id);
  const { dismissedKeys, dismissMany, undismissMany } = useNotificationDismissals();
  const { notifications, markRead, markAllRead: markMentionsRead, markUnreadMany } = useNotifications();

  const { items, unreadCount } = useMemo(() => {
    const visible = selectVisibleNotifications(derived, new Set(dismissedKeys ?? []));
    return mergeShellFeed(visible, notifications);
  }, [derived, dismissedKeys, notifications]);

  const open = useCallback(
    async (notice: ShellNotice) => {
      if (notice.source === "mention" && notice.unread) await markRead(notice.id);
    },
    [markRead],
  );

  const markAllRead = useCallback(async () => {
    const mentionIds = items.filter((i) => i.source === "mention" && i.unread).map((i) => i.id);
    const derivedKeys = items.filter((i) => i.source === "derived").map((i) => i.id);
    const total = mentionIds.length + derivedKeys.length;
    if (total === 0) return;
    try {
      await Promise.all([markMentionsRead(), dismissMany(derivedKeys)]);
    } catch (e) {
      showError(e);
      return;
    }
    let undone = false;
    toast(`Marked ${total} read`, {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: async () => {
          if (undone) return;
          undone = true;
          try {
            await Promise.all([markUnreadMany(mentionIds), undismissMany(derivedKeys)]);
          } catch (e) {
            showError(e);
          }
        },
      },
    });
  }, [items, markMentionsRead, dismissMany, markUnreadMany, undismissMany]);

  return { items, unreadCount, open, markAllRead };
}
