"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Browser-direct read + writes for the mentions inbox (work-layer phase 0,
 * #1241, work-layer.md §10.2). Both queries are reactive — a mention landing,
 * or a mark-read/archive write, updates the bell live with no poll and no
 * manual refetch (unlike the derived `useNotificationsFeed`, which still backs
 * the dashboard's "Needs attention" chip tray and the /notifications page,
 * unchanged).
 */
export function useNotifications() {
  const notifications = useAuthedQuery(api.notifications.listForMe, { limit: 20 });
  const unreadCount = useAuthedQuery(api.notifications.unreadCountForMe, {});
  const markReadM = useMutation(api.notificationsWrites.markReadNative);
  const markAllReadM = useMutation(api.notificationsWrites.markAllReadNative);
  const archiveM = useMutation(api.notificationsWrites.archiveNative);

  const markRead = useCallback(async (id: string) => {
    await markReadM({ id });
  }, [markReadM]);

  const markAllRead = useCallback(async () => {
    await markAllReadM({});
  }, [markAllReadM]);

  const archive = useCallback(async (id: string) => {
    await archiveM({ id });
  }, [archiveM]);

  return {
    /** Recent, non-archived notifications (reactive; `undefined` while loading). */
    notifications: notifications as Doc<"notifications">[] | undefined,
    /** Unread count (reactive; `undefined` while loading). */
    unreadCount: unreadCount as number | undefined,
    markRead,
    markAllRead,
    archive,
  };
}
