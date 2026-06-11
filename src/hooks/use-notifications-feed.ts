"use client";

import { useEffect, useState } from "react";
import { getNotifications, type AppNotification } from "@/server/notifications";

/**
 * Shared, deduped, visibility-aware poll for the cross-domain notifications
 * aggregate (`getNotifications` scans 9 domains). Both observers — the
 * always-mounted app-shell bell and the `/notifications` page — subscribe to ONE
 * module-level poller per orgId, so the scan runs once per interval no matter how
 * many components are mounted (the request sharing React Query gave the common
 * `["notifications", orgId]` key), and it pauses while the tab is hidden (RQ's
 * `refetchIntervalInBackground: false` default). Replaces the React Query
 * `useQuery` + `refetchInterval` (Phase 6 — RQ removal; both codex P2s).
 */
const INTERVAL_MS = 60_000;

type Feed = {
  data: AppNotification[] | undefined;
  subscribers: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  onVisible: (() => void) | null;
  inFlight: Promise<void> | null;
};

const feeds = new Map<string, Feed>();

function feedFor(orgId: string): Feed {
  let f = feeds.get(orgId);
  if (!f) {
    f = { data: undefined, subscribers: new Set(), timer: null, onVisible: null, inFlight: null };
    feeds.set(orgId, f);
  }
  return f;
}

/** Fetch once, sharing a single in-flight request across concurrent callers. */
function refresh(orgId: string): Promise<void> {
  const f = feedFor(orgId);
  if (f.inFlight) return f.inFlight;
  f.inFlight = getNotifications()
    .then((data) => {
      f.data = data;
      f.subscribers.forEach((cb) => cb());
    })
    .catch(() => {
      // Keep last-known data on failure — same as a poll that missed a tick.
    })
    .finally(() => {
      f.inFlight = null;
    });
  return f.inFlight;
}

export function useNotificationsFeed(orgId: string | undefined): {
  data: AppNotification[] | undefined;
  isLoading: boolean;
  refresh: () => void;
} {
  const [, force] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    const f = feedFor(orgId);
    const cb = () => force((n) => n + 1);
    f.subscribers.add(cb);

    void refresh(orgId); // ensure data on first subscribe (deduped)

    if (!f.timer) {
      // Poll, but skip ticks while hidden and catch up on becoming visible again
      // (matches the use-server-query poll semantics; codex review).
      f.timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void refresh(orgId);
      }, INTERVAL_MS);
      f.onVisible = () => {
        if (typeof document !== "undefined" && !document.hidden) void refresh(orgId);
      };
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", f.onVisible);
      }
    }

    return () => {
      f.subscribers.delete(cb);
      if (f.subscribers.size === 0) {
        if (f.timer) {
          clearInterval(f.timer);
          f.timer = null;
        }
        if (f.onVisible && typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", f.onVisible);
          f.onVisible = null;
        }
      }
    };
  }, [orgId]);

  const data = orgId ? feeds.get(orgId)?.data : undefined;
  return {
    data,
    isLoading: !!orgId && data === undefined,
    refresh: () => {
      if (orgId) void refresh(orgId);
    },
  };
}
