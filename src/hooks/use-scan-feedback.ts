"use client";

import { useCallback, useEffect, useState } from "react";
import { playScanFeedback, playScanHaptic, type ScanFeedbackKind } from "@/lib/scan-feedback";

/**
 * One scan verdict for the scan history strip (#1223, D6 — in-memory, per
 * session, not persisted). `label` is what was scanned as the operator would
 * say it ("SM58 · A-1042"); `outcome` is the verdict in words ("Prepped",
 * "Already deployed"). `undo`, when present, must be the EXACT reverse
 * trigger the write's own toast Undo button calls (e.g.
 * `AnnouncedWrite.scanUndo` from `warehouse-undo-toast.ts`) — never a second,
 * independently-derived reverse, so the strip and the toast can never
 * disagree about whether an undo already fired.
 */
export interface ScanHistoryEntry {
  label: string;
  outcome: string;
  undo?: { label: string; run: () => void | Promise<void> };
}

/** A recorded entry, stamped with its verdict kind and wall-clock time. */
export interface ScanHistoryRecord extends ScanHistoryEntry {
  kind: ScanFeedbackKind;
  at: number;
}

/** The strip shows at most the last five scans (spec: "the last five"). */
const MAX_HISTORY_ENTRIES = 5;

/**
 * Among a newest-first list, strip `undo` from every entry except the single
 * newest one that carries it — "a strip full of Undo buttons invites undoing
 * the wrong thing" (design doc). Pure so it can run on every render cheaply
 * (at most 5 entries).
 */
function exposeNewestUndoOnly(entries: ScanHistoryRecord[]): ScanHistoryRecord[] {
  let seenUndo = false;
  return entries.map((entry) => {
    if (!entry.undo) return entry;
    if (seenUndo) return { ...entry, undo: undefined };
    seenUndo = true;
    return entry;
  });
}

/**
 * localStorage key for the scan-feedback toggle. Deliberately **not** scoped to
 * the signed-in user (unlike `usePersistentPref`) — warehouse terminals are
 * shared devices, and the "feedback on/off" preference belongs to the
 * terminal, not the operator currently signed in on it.
 *
 * Named `rvlt.scanAudio` from when this toggle covered audio only — kept as-is
 * (rather than renamed to `rvlt.scanFeedback`) so no terminal's persisted
 * preference silently resets when haptics (#1220) were added under the same
 * one toggle (D5).
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
 * Shared scan-feedback hook: a per-device, localStorage-persisted toggle
 * plus a `play(kind)` helper wired to both `playScanFeedback` (audio) and
 * `playScanHaptic` (vibration) — one toggle covers both (D5, #1220). Used by
 * every scan verdict call site (Warehouse prep/deploy/return, T&T quick-test,
 * the `/check/[assetTag]` ad-hoc station, and future consumers like the WS5
 * returns station) so the toggle and tone/pattern vocabulary stay in one
 * place.
 *
 * See FEATUREDOCS/12 (Scan Feedback) and FEATUREDOCS/14 (Audio note).
 */
export function useScanFeedback(): {
  enabled: boolean;
  toggle: () => void;
  play: (kind: ScanFeedbackKind, entry?: ScanHistoryEntry) => void;
  /** Last five scan verdicts, newest first (#1223). Recording is independent
   *  of `enabled` — it's a visual memory aid, not audio/haptic feedback. */
  entries: ScanHistoryRecord[];
} {
  // Initialise to the default so server and first client render agree — reading
  // localStorage in the initializer would diverge from SSR and throw a hydration
  // mismatch. The effect below syncs the persisted value in right after mount.
  const [enabled, setEnabled] = useState(DEFAULT_ENABLED);
  const [entries, setEntries] = useState<ScanHistoryRecord[]>([]);

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
    (kind: ScanFeedbackKind, entry?: ScanHistoryEntry) => {
      if (enabled) {
        playScanFeedback(kind);
        playScanHaptic(kind);
      }
      if (entry) {
        setEntries((prev) => [{ ...entry, kind, at: Date.now() }, ...prev].slice(0, MAX_HISTORY_ENTRIES));
      }
    },
    [enabled],
  );

  return { enabled, toggle, play, entries: exposeNewestUndoOnly(entries) };
}
