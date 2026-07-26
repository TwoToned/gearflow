"use client";

import { useCallback, useEffect, useState } from "react";
import { playScanFeedback, type ScanFeedbackKind } from "@/lib/scan-feedback";

/**
 * localStorage key for the scan-audio toggle. Deliberately **not** scoped to the
 * signed-in user (unlike `usePersistentPref`) — warehouse terminals are shared
 * devices, and the "audio on/off" preference belongs to the terminal, not the
 * operator currently signed in on it.
 */
const STORAGE_KEY = "rvlt.scanAudio";
const DEFAULT_ENABLED = true;

function readEnabled(): boolean {
  if (typeof window === "undefined") return DEFAULT_ENABLED;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_ENABLED;
    return JSON.parse(raw) === true;
  } catch {
    return DEFAULT_ENABLED;
  }
}

/**
 * Shared scan-feedback hook: a per-device, localStorage-persisted audio toggle
 * plus a `play(kind)` helper wired to `playScanFeedback`. Used by every scan
 * verdict call site (Warehouse prep/deploy/return, T&T quick-test, the
 * `/check/[assetTag]` ad-hoc station, and future consumers like the WS5 returns
 * station) so the toggle and tone vocabulary stay in one place.
 *
 * See FEATUREDOCS/12 (Scan Feedback) and FEATUREDOCS/14 (Audio note).
 */
export function useScanFeedback(): {
  enabled: boolean;
  toggle: () => void;
  play: (kind: ScanFeedbackKind) => void;
} {
  // Initialise to the default so server and first client render agree — reading
  // localStorage in the initializer would diverge from SSR and throw a hydration
  // mismatch. The effect below syncs the persisted value in right after mount.
  const [enabled, setEnabled] = useState(DEFAULT_ENABLED);

  useEffect(() => {
    setEnabled(readEnabled());
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore quota / unavailable storage
        }
      }
      return next;
    });
  }, []);

  const play = useCallback(
    (kind: ScanFeedbackKind) => {
      if (!enabled) return;
      playScanFeedback(kind);
    },
    [enabled],
  );

  return { enabled, toggle, play };
}
