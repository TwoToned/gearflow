"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  defaultWidgetPosition,
  DASHBOARD_WIDGET_ORDER,
  type DashboardLayoutWidget,
  type DashboardWidgetKind,
} from "@/lib/dashboard-widgets";
import { api } from "../../convex/_generated/api";

// Commit on drag/resize END, never per intermediate frame (CLAUDE.md: "Debounce
// writes on the client"). A user dragging around for a few seconds should
// produce ONE write, not dozens.
const SAVE_DEBOUNCE_MS = 800;

/**
 * The customizable dashboard's per-user layout (`convex/dashboardLayouts.ts`,
 * modeled on `savedTableViews`'s self-scoped per-user row pattern). No saved row
 * yet ⇒ `DEFAULT_DASHBOARD_LAYOUT` (everything from the pre-widget-board `/dashboard` at
 * its original position/size) — the default lives in exactly one place
 * (`src/lib/dashboard-widgets.ts`), never invented here or on the server.
 */
export function useDashboardLayout(orgId: string | undefined) {
  const saved = useAuthedQuery(api.dashboardLayouts.get, orgId ? {} : "skip");
  const saveMutation = useMutation(api.dashboardLayouts.saveNative);

  const [widgets, setWidgets] = useState<DashboardLayoutWidget[] | null>(null);
  const hydratedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowIdRef = useRef<string>(createId());

  // Hydrate local state exactly once from the server (or the default) — after
  // that, local state is the source of truth so an in-flight edit is never
  // clobbered by the query re-running.
  useEffect(() => {
    if (hydratedRef.current || saved === undefined) return;
    hydratedRef.current = true;
    if (saved) {
      rowIdRef.current = saved.id;
      setWidgets(saved.widgets as DashboardLayoutWidget[]);
    } else {
      setWidgets(DEFAULT_DASHBOARD_LAYOUT);
    }
  }, [saved]);

  const persist = useCallback(
    (next: DashboardLayoutWidget[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void saveMutation({ id: rowIdRef.current, widgets: next, now: Date.now() }).catch(() => {
          // Best-effort — a failed layout save never blocks the UI; the next
          // successful save (or a page reload re-reading the last saved row)
          // reconciles it. Not surfaced as a toast: a personal arrangement of
          // widgets isn't worth interrupting someone over.
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [saveMutation],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const commit = useCallback(
    (next: DashboardLayoutWidget[]) => {
      setWidgets(next);
      persist(next);
    },
    [persist],
  );

  const addWidget = useCallback(
    (kind: DashboardWidgetKind) => {
      setWidgets((current) => {
        const base = current ?? [];
        if (base.some((w) => w.kind === kind)) return base;
        const next = [...base, defaultWidgetPosition(kind, base)];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeWidget = useCallback(
    (id: string) => {
      setWidgets((current) => {
        const base = current ?? [];
        const next = base.filter((w) => w.id !== id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const resetToDefault = useCallback(() => {
    commit(DEFAULT_DASHBOARD_LAYOUT);
  }, [commit]);

  // `DASHBOARD_WIDGET_ORDER` (not `Object.keys(DASHBOARD_WIDGET_REGISTRY)`) is
  // the single source of truth for the "Add widget" popover's listing order
  // (R-3.1) — the registry object's own key order happens to agree today, but
  // nothing enforces that, so relying on it would silently drift the moment
  // either one is reordered without the other.
  const availableToAdd = useMemo(() => {
    const present = new Set((widgets ?? []).map((w) => w.kind));
    return DASHBOARD_WIDGET_ORDER.filter((k) => !present.has(k));
  }, [widgets]);

  return {
    widgets: widgets ?? DEFAULT_DASHBOARD_LAYOUT,
    isLoading: widgets === null,
    /** Commit a full layout change (drag/resize end) — debounced. */
    setLayout: commit,
    addWidget,
    removeWidget,
    resetToDefault,
    availableToAdd,
  };
}
