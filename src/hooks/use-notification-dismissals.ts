"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct notification-dismissal read + writes (Phase 3 — replaces the
 * getDismissedKeys / dismissNotification / dismissNotifications /
 * pruneStaleDismissals server actions). The dismissed-key list subscribes to
 * Convex (`api.notificationDismissalsWrites.mine`), so a dismiss/prune write
 * updates it live — no `["notification-dismissals", orgId]` React-Query poll or
 * manual refetch. userId/orgId are derived from the verified token INSIDE each
 * mutation; the browser never supplies them. Consumers keep their
 * `useServerMutation` UX wrappers and only swap the `mutationFn`.
 */
export function useNotificationDismissals() {
  const dismissedKeys = useAuthedQuery(api.notificationDismissalsWrites.mine, {});
  const dismissManyM = useMutation(api.notificationDismissalsWrites.dismissManyNative);
  const pruneM = useMutation(api.notificationDismissalsWrites.pruneStaleNative);

  // Convex's useMutation returns a stable fn, so these callbacks are stable across
  // renders — consumers pass them into useEffect/useCallback deps (the prune effect
  // must fire only when the active notification list changes, not every render).
  const dismiss = useCallback(
    async (notificationKey: string): Promise<void> => {
      if (!notificationKey) return;
      await dismissManyM({ items: [{ id: createId(), notificationKey }], now: Date.now() });
    },
    [dismissManyM],
  );

  const dismissMany = useCallback(
    async (notificationKeys: string[]): Promise<void> => {
      const items = [...new Set(notificationKeys.filter(Boolean))].map((notificationKey) => ({
        id: createId(),
        notificationKey,
      }));
      if (items.length === 0) return;
      await dismissManyM({ items, now: Date.now() });
    },
    [dismissManyM],
  );

  const prune = useCallback(
    async (activeKeys: string[]): Promise<void> => {
      await pruneM({ activeKeys });
    },
    [pruneM],
  );

  return {
    /** Dismissed keys for the current user in the active org (reactive; `undefined` while loading). */
    dismissedKeys: dismissedKeys as string[] | undefined,
    /** Dismiss a single notification key. */
    dismiss,
    /** Dismiss many keys in one call (Dismiss All). */
    dismissMany,
    /** GC dismissal rows whose key is no longer in the active notification set. */
    prune,
  };
}
