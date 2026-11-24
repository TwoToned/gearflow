"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { showError } from "@/lib/show-error";
import {
  DASHBOARD_WIDGET_REGISTRY,
  DEFAULT_DASHBOARD_LAYOUT,
  addableKinds,
  defaultWidgetPosition,
  withoutWidget,
  type DashboardLayoutWidget,
  type DashboardWidgetKind,
} from "@/lib/dashboard-widgets";
import { api } from "../../convex/_generated/api";

// Commit on drag/resize END, never per intermediate frame: a user dragging around
// for a few seconds produces ONE write, not dozens.
const SAVE_DEBOUNCE_MS = 800;

/** A saved widget can predate a registry change to its `minSize`/`maxSize`: clamp
 *  on load so an existing board picks up a raised floor automatically. A no-op for
 *  a widget already within bounds. */
function clampToRegistry(w: DashboardLayoutWidget): DashboardLayoutWidget {
  const def = DASHBOARD_WIDGET_REGISTRY[w.kind];
  if (!def) return w;
  let width = Math.max(w.w, def.minSize.w);
  let height = Math.max(w.h, def.minSize.h);
  if (def.maxSize) {
    width = Math.min(width, def.maxSize.w);
    height = Math.min(height, def.maxSize.h);
  }
  return width === w.w && height === w.h ? w : { ...w, w: width, h: height };
}

function sameLayout(a: readonly DashboardLayoutWidget[], b: readonly DashboardLayoutWidget[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((w, i) => {
    const o = b[i];
    return w.id === o.id && w.x === o.x && w.y === o.y && w.w === o.w && w.h === o.h;
  });
}

/**
 * Puts the board back exactly as it was before ONE change (UX Phase 11, Q6).
 * Throws `LAYOUT_CHANGED_SINCE` (the toast's Undo surfaces it) when the board
 * is no longer the one that change produced.
 */
export type LayoutRestore = () => void;

export const LAYOUT_CHANGED_SINCE = "Layout changed since. Undo the newer change first.";
export const LAYOUT_OTHER_ORG = "That change was on another organisation's Home, so nothing was put back here.";

/**
 * The per-user Home layout (`convex/dashboardLayouts.ts`). No saved row yet ⇒
 * `DEFAULT_DASHBOARD_LAYOUT`, which lives in exactly one place
 * (`src/lib/dashboard-widgets.ts`).
 *
 * Every change returns a `LayoutRestore`, the ONE closure that undoes it (the
 * page hands it to the toast's Undo), or `null` when nothing changed, so a
 * no-op never toasts. A failed save is surfaced, never swallowed.
 *
 * Everything is per ORG: switching org drops the pending save, re-hydrates from
 * the new org's row (the query is keyed by `orgId`, and both the read and the
 * save name it so the server rejects a mismatch), takes a fresh row id, and
 * turns any Undo still held from the old org into a refusal. Before this, a
 * switch kept org A's board on screen and could write it into org B's row.
 */
export function useDashboardLayout(orgId: string | undefined) {
  const saved = useAuthedQuery(api.dashboardLayouts.get, orgId ? { orgId } : "skip");
  const saveMutation = useMutation(api.dashboardLayouts.saveNative);

  // The board is stamped with the org it belongs to; another org's board is never shown.
  const [board, setBoard] = useState<{ orgId: string | undefined; widgets: DashboardLayoutWidget[] } | null>(null);
  const widgets = board && board.orgId === orgId ? board.widgets : null;
  const orgRef = useRef(orgId);
  const currentRef = useRef<DashboardLayoutWidget[]>(DEFAULT_DASHBOARD_LAYOUT);
  const hydratedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowIdRef = useRef<string>(createId());

  const setWidgets = useCallback((next: DashboardLayoutWidget[]) => setBoard({ orgId: orgRef.current, widgets: next }), []);

  const persist = useCallback(
    (next: DashboardLayoutWidget[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const org = orgRef.current;
      const id = rowIdRef.current;
      debounceRef.current = setTimeout(() => {
        if (!org || org !== orgRef.current) return;
        void saveMutation({ id, widgets: next, now: Date.now(), orgId: org }).catch((e: unknown) => {
          showError(e, { fallbackTitle: "Couldn't save your Home layout" });
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [saveMutation],
  );

  // An org switch: drop the old org's pending save and start over for the new one.
  // Declared before the hydrate effect so it runs first in the same commit.
  useEffect(() => {
    if (orgRef.current === orgId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    orgRef.current = orgId;
    hydratedRef.current = false;
    rowIdRef.current = createId();
    currentRef.current = DEFAULT_DASHBOARD_LAYOUT;
  }, [orgId]);

  // Hydrate local state exactly once per org from the server (or the default);
  // after that local state is the source of truth, so an in-flight edit is never
  // clobbered by the query re-running.
  useEffect(() => {
    if (hydratedRef.current || saved === undefined || orgRef.current !== orgId) return;
    hydratedRef.current = true;
    if (!saved) {
      setWidgets(DEFAULT_DASHBOARD_LAYOUT);
      return;
    }
    rowIdRef.current = saved.id;
    const raw = saved.widgets as DashboardLayoutWidget[];
    const healed = raw.map(clampToRegistry);
    currentRef.current = healed;
    setWidgets(healed);
    // Persist healed sizes once, silently: a board that predates a registry floor
    // change shouldn't stay at an invalid size until the user touches it.
    if (healed.some((w, i) => w !== raw[i])) persist(healed);
  }, [saved, persist, setWidgets, orgId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const apply = useCallback(
    (next: DashboardLayoutWidget[]): LayoutRestore | null => {
      const prev = currentRef.current;
      if (sameLayout(prev, next)) return null;
      const org = orgRef.current;
      currentRef.current = next;
      setWidgets(next);
      persist(next);
      return () => {
        // An Undo from another org's Home writes nothing here.
        if (orgRef.current !== org) throw new Error(LAYOUT_OTHER_ORG);
        // Tied to the board THIS change produced: once anything else moved it, putting
        // `prev` back would silently revert the later change too, so it refuses instead.
        if (currentRef.current !== next) throw new Error(LAYOUT_CHANGED_SINCE);
        currentRef.current = prev;
        setWidgets(prev);
        persist(prev);
      };
    },
    [persist],
  );

  const addWidget = useCallback(
    (kind: DashboardWidgetKind): LayoutRestore | null => {
      const base = currentRef.current;
      if (base.some((w) => w.kind === kind)) return null;
      return apply([...base, defaultWidgetPosition(kind, base)]);
    },
    [apply],
  );

  // Hiding a setup slot hides BOTH setup kinds in one change (`withoutWidget`).
  const removeWidget = useCallback(
    (id: string): LayoutRestore | null => apply(withoutWidget(currentRef.current, id)),
    [apply],
  );

  const resetToDefault = useCallback((): LayoutRestore | null => apply(DEFAULT_DASHBOARD_LAYOUT), [apply]);

  // `DASHBOARD_WIDGET_ORDER` is the single source of the "Add widget" listing order;
  // the setup panel is offered once, and again once both setup kinds are hidden.
  const availableToAdd = useMemo(() => addableKinds(widgets ?? []), [widgets]);

  return {
    widgets: widgets ?? DEFAULT_DASHBOARD_LAYOUT,
    isLoading: widgets === null,
    /** Commit a full layout change (drag/resize end), debounced. */
    setLayout: apply,
    addWidget,
    removeWidget,
    resetToDefault,
    availableToAdd,
  };
}
