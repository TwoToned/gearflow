import type { ComponentType } from "react";
import { OnTheFloorNowWidget } from "@/components/dashboard/widgets/on-the-floor-now-widget";
import { NeedsAttentionWidget } from "@/components/dashboard/widgets/needs-attention-widget";
import {
  StatActiveJobsWidget,
  StatOverdueReturnsWidget,
  StatGearDeployedWidget,
  StatCrewBookedWidget,
} from "@/components/dashboard/widgets/stat-tile-widgets";
import { UpcomingProjectsWidget } from "@/components/dashboard/widgets/upcoming-projects-widget";
import { RecentActivityWidget } from "@/components/dashboard/widgets/recent-activity-widget";
import { SetupPanel } from "@/components/dashboard/setup-panel";
import { MyTasksWidget } from "@/components/dashboard/widgets/my-tasks-widget";
import { DASHBOARD_LINKS, type DashboardLink } from "@/lib/dashboard-links";
import type { DashboardWidgetKind } from "@/lib/dashboard-widget-kind";

/**
 * The customizable dashboard's widget catalog (FEATUREDOCS/81, DESIGN.md
 * "Dashboard Layout"). Every widget is sourced from data the app already reads
 * (R-3.1). A widget kind is a SINGLETON on a board: widgets are parameter-free,
 * so `id === kind` and "Add widget" lists kinds not already on the board.
 *
 * Every kind stays registered even when the UI merges two of them
 * (`finishSetupChecklist` + `activationChecklist` are ONE setup panel since UX
 * Phase 11), so a saved board always loads.
 */
export type { DashboardWidgetKind } from "@/lib/dashboard-widget-kind";

interface DashboardWidgetGeometry {
  w: number;
  h: number;
}

export interface DashboardLayoutWidget extends DashboardWidgetGeometry {
  id: string;
  kind: DashboardWidgetKind;
  x: number;
  y: number;
}

export interface DashboardWidgetDef {
  kind: DashboardWidgetKind;
  title: string;
  /** One line shown in the "Add widget" popover. */
  description: string;
  component: ComponentType<{ orgId: string | undefined }>;
  defaultSize: DashboardWidgetGeometry;
  minSize: DashboardWidgetGeometry;
  maxSize?: DashboardWidgetGeometry;
  /** A stat tile: a number, no header outside Customise mode; two to a row on phone. */
  stat?: boolean;
  /** The widget header's `View all ›` (from the one link table). */
  viewAll?: DashboardLink;
  /** The two checklist kinds share ONE slot (the setup panel). */
  setupSlot?: boolean;
}

// 12-column desktop grid.
export const GRID_COLS = 12;

// Heights are sized against each widget's rendered content: a ~26px header row
// plus the widget's own rows (32px grid rows, 16px gutters). A stat tile (number
// + label + sub, + the meter on Gear deployed) fits in h:4 with room, used as
// both default and floor so no tile can be shrunk into clipping. An open-ended
// list may scroll at any size; its min still fits a couple of rows.
export const DASHBOARD_WIDGET_REGISTRY: Record<DashboardWidgetKind, DashboardWidgetDef> = {
  onTheFloorNow: {
    kind: "onTheFloorNow",
    title: "On the floor now",
    description: "Live jobs currently out or on site, soonest back first.",
    component: OnTheFloorNowWidget,
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 4, h: 4 },
    viewAll: DASHBOARD_LINKS.floor,
  },
  needsAttention: {
    kind: "needsAttention",
    title: "Needs attention",
    description: "Org-wide risk lines: overdue returns and invoices, maintenance, crew offers, overbookings, quotes.",
    component: NeedsAttentionWidget,
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 4, h: 3 },
  },
  statActiveJobs: {
    kind: "statActiveJobs",
    title: "Active jobs",
    description: "Count of booked and out jobs.",
    component: StatActiveJobsWidget,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 4 },
    maxSize: { w: 4, h: 5 },
    stat: true,
  },
  statOverdueReturns: {
    kind: "statOverdueReturns",
    title: "Overdue returns",
    description: "Count of jobs past their end date with gear still out.",
    component: StatOverdueReturnsWidget,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 4 },
    maxSize: { w: 4, h: 5 },
    stat: true,
  },
  statGearDeployed: {
    kind: "statGearDeployed",
    title: "Gear deployed",
    description: "Assets out right now, with a utilisation meter.",
    component: StatGearDeployedWidget,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 4 },
    maxSize: { w: 4, h: 5 },
    stat: true,
  },
  statCrewBooked: {
    kind: "statCrewBooked",
    title: "Crew booked",
    description: "Crew currently on the books.",
    component: StatCrewBookedWidget,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 4 },
    maxSize: { w: 4, h: 5 },
    stat: true,
  },
  upcomingProjects: {
    kind: "upcomingProjects",
    title: "Upcoming",
    description: "Jobs booked ahead, soonest first.",
    component: UpcomingProjectsWidget,
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 3, h: 3 },
    viewAll: DASHBOARD_LINKS.upcoming,
  },
  recentActivity: {
    kind: "recentActivity",
    title: "Recent activity",
    description: "Scans, tests and maintenance updates across the org.",
    component: RecentActivityWidget,
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 4, h: 3 },
    viewAll: DASHBOARD_LINKS.activity,
  },
  finishSetupChecklist: {
    kind: "finishSetupChecklist",
    title: "Finish setup",
    description: "Org setup and first-run milestones in one panel. Hides itself once complete or dismissed.",
    component: SetupPanel,
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 3, h: 4 },
    setupSlot: true,
  },
  activationChecklist: {
    kind: "activationChecklist",
    title: "Get started",
    description: "First-run milestones, shown in the setup panel. Hides itself once complete or dismissed.",
    component: SetupPanel,
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 3, h: 4 },
    setupSlot: true,
  },
  myTasks: {
    kind: "myTasks",
    title: "My tasks",
    description: "Your open tasks across every job.",
    component: MyTasksWidget,
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 3, h: 4 },
    viewAll: DASHBOARD_LINKS.myTasks,
  },
};

/** Stable listing order for the "Add widget" popover. */
export const DASHBOARD_WIDGET_ORDER: DashboardWidgetKind[] = [
  "onTheFloorNow",
  "needsAttention",
  "statActiveJobs",
  "statOverdueReturns",
  "statGearDeployed",
  "statCrewBooked",
  "upcomingProjects",
  "recentActivity",
  "finishSetupChecklist",
  "activationChecklist",
  "myTasks",
];

function widget(kind: DashboardWidgetKind, x: number, y: number): DashboardLayoutWidget {
  const { w, h } = DASHBOARD_WIDGET_REGISTRY[kind].defaultSize;
  return { id: kind, kind, x, y, w, h };
}

/**
 * The default board (D87): the setup panel, the four stat tiles, then My tasks
 * and Needs attention side by side (6 + 6), then On the floor now, Upcoming and
 * Recent activity. "Quick stats, then any tasks." The two checklist kinds both
 * sit at the top; the grid renders the one panel in the first. A saved board is
 * never rewritten; "Reset layout" brings this back.
 */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutWidget[] = [
  widget("finishSetupChecklist", 0, 0),
  widget("activationChecklist", 0, 5),
  widget("statActiveJobs", 0, 10),
  widget("statOverdueReturns", 3, 10),
  widget("statGearDeployed", 6, 10),
  widget("statCrewBooked", 9, 10),
  widget("myTasks", 0, 14),
  widget("needsAttention", 6, 14),
  widget("onTheFloorNow", 0, 20),
  widget("upcomingProjects", 0, 25),
  widget("recentActivity", 0, 30),
];

export function defaultWidgetPosition(kind: DashboardWidgetKind, existing: DashboardLayoutWidget[]): DashboardLayoutWidget {
  const { w, h } = DASHBOARD_WIDGET_REGISTRY[kind].defaultSize;
  const y = existing.reduce((max, w2) => Math.max(max, w2.y + w2.h), 0);
  return { id: kind, kind, x: 0, y, w, h };
}

const isSetupKind = (kind: DashboardWidgetKind): boolean => DASHBOARD_WIDGET_REGISTRY[kind]?.setupSlot === true;

/**
 * The board without widget `id`. The two setup kinds are ONE panel, so hiding
 * either hides both, in one change (one toast, one Undo): removing only the
 * clicked slot would just promote the other and the panel would stay.
 */
export function withoutWidget(widgets: readonly DashboardLayoutWidget[], id: string): DashboardLayoutWidget[] {
  const target = widgets.find((w) => w.id === id);
  if (target && isSetupKind(target.kind)) return widgets.filter((w) => !isSetupKind(w.kind));
  return widgets.filter((w) => w.id !== id);
}

/**
 * What "Add widget" offers, in `DASHBOARD_WIDGET_ORDER`: every kind not on the
 * board, with the setup panel offered ONCE (as its first kind) and only while
 * neither setup kind is on the board.
 */
export function addableKinds(widgets: readonly DashboardLayoutWidget[]): DashboardWidgetKind[] {
  const present = new Set(widgets.map((w) => w.kind));
  const hasSetup = [...present].some(isSetupKind);
  const firstSetup = DASHBOARD_WIDGET_ORDER.find(isSetupKind);
  return DASHBOARD_WIDGET_ORDER.filter((k) => !present.has(k) && (!isSetupKind(k) || (!hasSetup && k === firstSetup)));
}

/** Is any setup kind on the board? (When none is, the panel's reads are skipped.) */
export function boardHasSetup(widgets: readonly DashboardLayoutWidget[]): boolean {
  return widgets.some((w) => isSetupKind(w.kind));
}

/** The widgets as one reads them: top to bottom, then left to right (phone and screen-reader order). */
export function readingOrder<T extends Pick<DashboardLayoutWidget, "x" | "y">>(widgets: readonly T[]): T[] {
  return [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Of the board's widgets, the ones that actually render: unknown kinds (a saved
 * board can outlive a removed kind) are dropped, and the two setup kinds collapse
 * to the first one present in reading order, only while the panel has something
 * to show.
 */
export function renderedWidgets(widgets: readonly DashboardLayoutWidget[], setupVisible: boolean): DashboardLayoutWidget[] {
  const known = widgets.filter((w) => DASHBOARD_WIDGET_REGISTRY[w.kind]);
  const setupHost = setupVisible ? readingOrder(known).find((w) => DASHBOARD_WIDGET_REGISTRY[w.kind].setupSlot) : undefined;
  return known.filter((w) => !DASHBOARD_WIDGET_REGISTRY[w.kind].setupSlot || w === setupHost);
}
