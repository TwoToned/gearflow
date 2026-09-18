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
import { FinishSetupChecklistWidget } from "@/components/dashboard/widgets/finish-setup-checklist-widget";
import { ActivationChecklistWidget } from "@/components/dashboard/widgets/activation-checklist-widget";
import { TodayWorkListWidget } from "@/components/dashboard/widgets/today-work-list-widget";
import { TodayDayRailWidget } from "@/components/dashboard/widgets/today-day-rail-widget";
import { TodayNeedsYouRailWidget } from "@/components/dashboard/widgets/today-needs-you-rail-widget";

/**
 * The customizable dashboard's widget catalog (#1267 — see DESIGN.md's
 * "Dashboard Layout" section for the decision this supersedes, and
 * FEATUREDOCS/81). v1 is deliberately closed: every widget is sourced from
 * data the app already reads on `/dashboard` or `/today` (R-3.1) — no widget
 * introduces a new backend read, and each is a thin extraction of an
 * existing section's JSX into its own file, not new product logic.
 *
 * A widget kind is a SINGLETON on a board — v1's widgets are all
 * parameter-free (no per-instance config), so `id === kind` and "Add widget"
 * simply lists kinds not already on the board.
 */
export type DashboardWidgetKind =
  | "onTheFloorNow"
  | "needsAttention"
  | "statActiveJobs"
  | "statOverdueReturns"
  | "statGearDeployed"
  | "statCrewBooked"
  | "upcomingProjects"
  | "recentActivity"
  | "finishSetupChecklist"
  | "activationChecklist"
  | "todayWorkList"
  | "todayDayRail"
  | "todayNeedsYouRail";

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
}

// 12-column desktop grid (matches the app's existing `lg:grid-cols-4`-style
// bento layouts scaled up for finer drag/resize granularity).
export const GRID_COLS = 12;

export const DASHBOARD_WIDGET_REGISTRY: Record<DashboardWidgetKind, DashboardWidgetDef> = {
  onTheFloorNow: {
    kind: "onTheFloorNow",
    title: "On the floor now",
    description: "Live jobs currently checked out or on site.",
    component: OnTheFloorNowWidget,
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  needsAttention: {
    kind: "needsAttention",
    title: "Needs attention",
    description: "Org-wide risk chips — overdue returns, maintenance, crew offers, overbookings.",
    component: NeedsAttentionWidget,
    defaultSize: { w: 12, h: 3 },
    minSize: { w: 4, h: 2 },
  },
  statActiveJobs: {
    kind: "statActiveJobs",
    title: "Active jobs",
    description: "Count of in-flight jobs.",
    component: StatActiveJobsWidget,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
  },
  statOverdueReturns: {
    kind: "statOverdueReturns",
    title: "Overdue returns",
    description: "Count of returns past due.",
    component: StatOverdueReturnsWidget,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
  },
  statGearDeployed: {
    kind: "statGearDeployed",
    title: "Gear deployed",
    description: "Assets checked out right now, with a utilisation meter.",
    component: StatGearDeployedWidget,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
  },
  statCrewBooked: {
    kind: "statCrewBooked",
    title: "Crew booked",
    description: "Count of crew currently on the books.",
    component: StatCrewBookedWidget,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 4, h: 3 },
  },
  upcomingProjects: {
    kind: "upcomingProjects",
    title: "Upcoming",
    description: "Jobs booked ahead, soonest first.",
    component: UpcomingProjectsWidget,
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  recentActivity: {
    kind: "recentActivity",
    title: "Recent activity",
    description: "Scans, tests and maintenance updates across the org.",
    component: RecentActivityWidget,
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  finishSetupChecklist: {
    kind: "finishSetupChecklist",
    title: "Finish setup",
    description: "Org setup checklist (currency, branding, location, team). Hides itself once complete.",
    component: FinishSetupChecklistWidget,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  activationChecklist: {
    kind: "activationChecklist",
    title: "Get started",
    description: "First-run activation milestones. Hides itself once complete.",
    component: ActivationChecklistWidget,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  todayWorkList: {
    kind: "todayWorkList",
    title: "Work list",
    description: "Your Overdue/Today/Triage/Later tasks and mentions, from Today.",
    component: TodayWorkListWidget,
    defaultSize: { w: 8, h: 8 },
    minSize: { w: 4, h: 5 },
  },
  todayDayRail: {
    kind: "todayDayRail",
    title: "Your day",
    description: "Today's shifts and scheduled services, from Today.",
    component: TodayDayRailWidget,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
  },
  todayNeedsYouRail: {
    kind: "todayNeedsYouRail",
    title: "Needs you",
    description: "Declined/stale crew offers and expiring quotes on jobs you manage, from Today.",
    component: TodayNeedsYouRailWidget,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
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
  "todayWorkList",
  "todayDayRail",
  "todayNeedsYouRail",
];

function widget(kind: DashboardWidgetKind, x: number, y: number): DashboardLayoutWidget {
  const { w, h } = DASHBOARD_WIDGET_REGISTRY[kind].defaultSize;
  return { id: kind, kind, x, y, w, h };
}

/**
 * The default board — everything from the pre-#1267 `/dashboard` at its
 * existing order/size (CLAUDE.md: "everything from the current /dashboard at
 * its current position/size"). Today's three widgets are in the CATALOG
 * (`DASHBOARD_WIDGET_REGISTRY`/`DASHBOARD_WIDGET_ORDER` above) but
 * deliberately NOT pre-placed here — a user adds them via "Add widget" if
 * they want dashboard to also carry their personal work list.
 */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutWidget[] = [
  widget("finishSetupChecklist", 0, 0),
  widget("activationChecklist", 6, 0),
  widget("onTheFloorNow", 0, 4),
  widget("needsAttention", 0, 8),
  widget("statActiveJobs", 0, 11),
  widget("statOverdueReturns", 3, 11),
  widget("statGearDeployed", 6, 11),
  widget("statCrewBooked", 9, 11),
  widget("upcomingProjects", 0, 13),
  widget("recentActivity", 0, 17),
];

export function defaultWidgetPosition(kind: DashboardWidgetKind, existing: DashboardLayoutWidget[]): DashboardLayoutWidget {
  const { w, h } = DASHBOARD_WIDGET_REGISTRY[kind].defaultSize;
  const y = existing.reduce((max, w2) => Math.max(max, w2.y + w2.h), 0);
  return { id: kind, kind, x: 0, y, w, h };
}
