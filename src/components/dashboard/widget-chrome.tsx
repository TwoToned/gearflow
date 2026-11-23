"use client";

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";
import type { DashboardWidgetKind } from "@/lib/dashboard-widget-kind";

/**
 * The two places a widget writes into its card's header (UX Phase 11, §6c.2):
 * the muted mono count beside the title, and one quiet action on the right
 * (the setup panel's Dismiss). The card owns the header; a widget portals into
 * it, so the header is ONE row whatever the widget, and no widget renders a
 * second title bar of its own. Outside a card (a test, another host) both
 * render nothing.
 */
interface WidgetHeaderTargets {
  count: HTMLElement | null;
  action: HTMLElement | null;
}

export const WidgetHeaderContext = createContext<WidgetHeaderTargets>({ count: null, action: null });

/**
 * A quiet header word (`View all ›`, `Dismiss`) gets a 44 px HIT area on a phone
 * (DESIGN.md §15) through the shared `.tap-area` (globals.css), so the 26 px
 * header row itself doesn't grow.
 */
export const HEADER_ACTION_TAP = "tap-area";

/** Customise mode is on for this card: a widget's own links must not navigate while it is. */
export const WidgetEditModeContext = createContext(false);

export function useWidgetEditMode(): boolean {
  return useContext(WidgetEditModeContext);
}

/** The figure beside the widget title (`6`, `2 live`). Absent while loading. */
export function WidgetCount({ children }: { children: React.ReactNode }) {
  const { count } = useContext(WidgetHeaderContext);
  return count ? createPortal(children, count) : null;
}

/** One quiet action at the right of the widget header. */
export function WidgetAction({ children }: { children: React.ReactNode }) {
  const { action } = useContext(WidgetHeaderContext);
  return action ? createPortal(children, action) : null;
}

/**
 * The widget kinds actually rendered on the board right now, so one widget can
 * defer to another (Needs attention drops its overdue-returns line while the
 * Overdue returns tile is on the board: the same fact never twice).
 */
export const DashboardBoardContext = createContext<ReadonlySet<DashboardWidgetKind>>(new Set());

export function useBoardHas(kind: DashboardWidgetKind): boolean {
  return useContext(DashboardBoardContext).has(kind);
}
