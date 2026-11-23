"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import {
  LAST_SCAN_UNDO_MS,
  effectiveMode,
  parseScanUrl,
  readTag,
  scanHref,
  type LastScan,
  type ScanMode,
} from "@/lib/scan-page";

/** What a scan, a mode change or Clear will do once unsaved answers are discarded. */
export type PendingAction = { kind: "tag"; tag: string } | { kind: "mode"; mode: ScanMode } | { kind: "clear" };

/**
 * The Scan page's session (spec §9i.3, §9i.4): the URL (`?mode=&tag=`) is the loaded
 * state, so a deep link, a reload and the `/check/[tag]` redirect all land the same
 * way. Every input path ends in ONE `scan(tag)`: the same tag again toasts `already
 * open`, a tag over unsaved answers asks `Discard this check?`, anything else loads.
 * Last scans live in memory for this session only, per mode.
 */
export function useScanSession({ held }: { held: readonly ScanMode[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const url = useMemo(() => parseScanUrl(params), [params]);
  const mode = effectiveMode(url.mode, held);
  const tag = url.tag;

  // Whether the loaded form holds answers; the page reports it on every render.
  const dirtyRef = useRef(false);
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const go = useCallback(
    (next: { mode: ScanMode | null; tag: string | null }) => router.replace(scanHref(next), { scroll: false }),
    [router],
  );

  const apply = useCallback(
    (action: PendingAction) => {
      dirtyRef.current = false;
      if (action.kind === "tag") go({ mode, tag: action.tag });
      else if (action.kind === "mode") go({ mode: action.mode, tag });
      else go({ mode, tag: null });
    },
    [go, mode, tag],
  );

  const request = useCallback(
    (action: PendingAction) => {
      if (dirtyRef.current) setPending(action);
      else apply(action);
    },
    [apply],
  );

  // How the page reports a tag it can't read (sound + toast + Last scans); set by the page.
  const unreadableRef = useRef<(raw: string) => void>(() => {});
  const setOnUnreadable = useCallback((fn: (raw: string) => void) => {
    unreadableRef.current = fn;
  }, []);

  /** The ONE entry point every input path ends in. */
  const scan = useCallback(
    (raw: string) => {
      if (!raw.trim()) return;
      // The same rule the URL uses (`readTag`): a tag it would drop is reported, never lost.
      const next = readTag(raw);
      if (!next) return unreadableRef.current(raw.trim().slice(0, 128));
      if (next === tag) {
        toast.info(`${next} is already open`);
        return;
      }
      request({ kind: "tag", tag: next });
    },
    [request, tag],
  );

  const lastScans = useLastScans();

  return {
    pathname,
    mode,
    tag,
    scan,
    setMode: (m: ScanMode) => (m === mode ? undefined : request({ kind: "mode", mode: m })),
    clear: () => request({ kind: "clear" }),
    /** After a save: drop the loaded tag without asking (the answers are saved). */
    finishScan: () => apply({ kind: "clear" }),
    /** Put a tag back without asking (an Undo restoring its draft). */
    reload: (t: string) => apply({ kind: "tag", tag: t }),
    setDirty,
    setOnUnreadable,
    /** A `?tag=` the page couldn't read (an old link); the page reports it, then drops it. */
    badTag: url.badTag,
    dropBadTag: () => go({ mode, tag: null }),
    pending,
    confirmDiscard: () => {
      if (pending) apply(pending);
      setPending(null);
    },
    cancelDiscard: () => setPending(null),
    lastScans,
  };
}

/**
 * Last scans, newest first, per mode, this session only. A saved row carries the
 * save's ONE undo closure for {@link LAST_SCAN_UNDO_MS}, then loses it; the closure
 * itself is the toast's, so the two can never disagree (CLAUDE.md scan strip rule).
 */
function useLastScans() {
  const [entries, setEntries] = useState<LastScan[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  const dropUndo = useCallback((id: string) => {
    timers.current.delete(id);
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, undo: undefined } : e)));
  }, []);

  const add = useCallback(
    (entry: LastScan) => {
      setEntries((prev) => [entry, ...prev]);
      if (entry.undo) timers.current.set(entry.id, setTimeout(() => dropUndo(entry.id), LAST_SCAN_UNDO_MS));
    },
    [dropUndo],
  );

  /** A saved row whose Undo ran: the save no longer exists, so neither does its row. */
  const markUndone = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clear = useCallback((mode: ScanMode) => {
    setEntries((prev) => prev.filter((e) => e.mode !== mode));
  }, []);

  return { entries, add, markUndone, clear };
}
