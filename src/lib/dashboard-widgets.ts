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
 * The customizable dashboard's widget catalog (see DESIGN.md's
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

// Every min/default height below is sized against each widget's ACTUAL
// rendered content (header bar ~38px + `p-4` content padding ~32px, on top
// of whatever the widget itself renders) — not a shared guess. `<DashboardCard>`
// adds a title bar that none of these widgets budgeted for in their original
// (non-widget-board) home, so copying their pre-board pixel heights straight
// into `defaultSize` undersizes almost all of them; a stat tile at the old
// default (h:2) rendered nothing but a clipped, scrolling sliver. `minSize`
// is the floor a user can drag a card down to — it must still fit that
// widget's content with NO internal scroll for anything that's meant to be
// glanceable (stats, chips, checklists); a genuinely unbounded list (activity
// feed, work list) is allowed to scroll at any size, since there's no size
// that guarantees it never will, but its min still has to fit at least a
// couple of rows so it reads as a list, not a sliver.
export const DASHBOARD_WIDGET_REGISTRY: Record<DashboardWidgetKind, DashboardWidgetDef> = {
  onTheFloorNow: {
    kind: "onTheFloorNow",
    title: "On the floor now",
    description: "Live jobs currently checked out or on site.",
    component: OnTheFloorNowWidget,
    // Empty state (mascot + 2 lines) or a couple of `LiveJobRow`s (~56px
    // each in the 2-col grid) — h:5 fits the empty state comfortably and up
    // to ~2 rows before scrolling.
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 4, h: 4 },
  },
  needsAttention: {
    kind: "needsAttention",
    title: "Needs attention",
    description: "Org-wide risk chips — overdue returns, maintenance, crew offers, overbookings.",
    component: NeedsAttentionWidget,
    // A chip row is ~34px; narrowed to its min width the chips wrap to 2-3
    // rows, so the floor needs more height than the roomy default does.
    defaultSize: { w: 12, h: 3 },
    minSize: { w: 4, h: 3 },
  },
  // Stat tiles: dot row + a 38px leading-none number + a micro sub-line ≈
  // 78px of content, +32px content padding +38px header ≈ 148px. h:2 (old
  // default AND min) is 80px — that's the crushed, scrolling tile from the
  // dashboard screenshot. h:4 (176px) fits every stat tile, including
  // Gear Deployed's extra utilisation-meter row, with room to spare — used
  // as both default and floor so no stat tile can be shrunk into breaking.
  statActiveJobs: {
    kind: "statActiveJobs",
    title: "Active jobs",
    description: "Count of in-flight jobs.",
    component: StatActiveJobsWidget,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 4 },
    maxSize: { w: 4, h: 5 },
  },
  statOverdueReturns: {
    kind: "statOverdueReturns",
    title: "Overdue returns",
    description: "Count of returns past due.",
    component: StatOverdueReturnsWidget,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 4 },
    maxSize: { w: 4, h: 5 },
  },
  statGearDeployed: {
    kind: "statGearDeployed",
    title: "Gear deployed",
    description: "Assets checked out right now, with a utilisation meter.",
    component: StatGearDeployedWidget,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 4 },
    maxSize: { w: 4, h: 5 },
  },
  statCrewBooked: {
    kind: "statCrewBooked",
    title: "Crew booked",
    description: "Count of crew currently on the books.",
    component: StatCrewBookedWidget,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 4 },
    maxSize: { w: 4, h: 5 },
  },
  upcomingProjects: {
    kind: "upcomingProjects",
    title: "Upcoming",
    description: "Jobs booked ahead, soonest first.",
    component: UpcomingProjectsWidget,
    // Up to 4 preview rows behind its own "All →" link — a preview list, so
    // some scroll at the default size is fine; the min just needs to show
    // more than one row.
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 3, h: 3 },
  },
  recentActivity: {
    kind: "recentActivity",
    title: "Recent activity",
    description: "Scans, tests and maintenance updates across the org.",
    component: RecentActivityWidget,
    // An open-ended feed — no size makes this never scroll, so the min just
    // guarantees a readable couple of rows rather than a sliver.
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 4, h: 3 },
  },
  finishSetupChecklist: {
    kind: "finishSetupChecklist",
    title: "Finish setup",
    description: "Org setup checklist (currency, branding, location, team). Hides itself once complete.",
    component: FinishSetupChecklistWidget,
    // Intro line + progress bar + up to 4 checklist rows ≈ 178px of content
    // — h:4 (176px total card) clipped the last row; h:6 (272px) fits all
    // four with room. Min stays one row shorter than default, not lower.
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 3, h: 4 },
  },
  activationChecklist: {
    kind: "activationChecklist",
    title: "Get started",
    description: "First-run activation milestones. Hides itself once complete.",
    component: ActivationChecklistWidget,
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 3, h: 4 },
  },
  todayWorkList: {
    kind: "todayWorkList",
    title: "Work list",
    description: "Your Overdue/Today/Triage/Later tasks and mentions, from Today.",
    component: TodayWorkListWidget,
    // Multiple bucket headers + quick-add + rows — inherently open-ended
    // like Today's own page; default is already generous, min just needs
    // enough for quick-add plus a visible bucket or two.
    defaultSize: { w: 8, h: 8 },
    minSize: { w: 4, h: 6 },
  },
  todayDayRail: {
    kind: "todayDayRail",
    title: "Your day",
    description: "Today's shifts and scheduled services, from Today.",
    component: TodayDayRailWidget,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  todayNeedsYouRail: {
    kind: "todayNeedsYouRail",
    title: "Needs you",
    description: "Declined/stale crew offers and expiring quotes on jobs you manage, from Today.",
    component: TodayNeedsYouRailWidget,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 4 },
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
 * The default board — everything from the pre-widget-board `/dashboard` at its
 * existing order/size (CLAUDE.md: "everything from the current /dashboard at
 * its current position/size"), plus the personal work list (`todayWorkList`)
 * directly under the setup checklists. Follow-up automation (design D3,
 * docs/designs/follow-up-automation.md §8.6) made that list where automated
 * quote follow-ups land, so a board without it would hide them — this
 * reverses the earlier "don't pre-place Today's widgets" call for the work
 * list only. The day rail and needs-you rail stay catalog-only. An existing
 * saved board is not rewritten; "Add widget" or "Reset to default" brings it in.
 */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutWidget[] = [
  widget("finishSetupChecklist", 0, 0),
  widget("activationChecklist", 6, 0),
  widget("todayWorkList", 0, 6),
  widget("onTheFloorNow", 0, 14),
  widget("needsAttention", 0, 19),
  widget("statActiveJobs", 0, 22),
  widget("statOverdueReturns", 3, 22),
  widget("statGearDeployed", 6, 22),
  widget("statCrewBooked", 9, 22),
  widget("upcomingProjects", 0, 26),
  widget("recentActivity", 0, 31),
];

export function defaultWidgetPosition(kind: DashboardWidgetKind, existing: DashboardLayoutWidget[]): DashboardLayoutWidget {
  const { w, h } = DASHBOARD_WIDGET_REGISTRY[kind].defaultSize;
  const y = existing.reduce((max, w2) => Math.max(max, w2.y + w2.h), 0);
  return { id: kind, kind, x: 0, y, w, h };
}
