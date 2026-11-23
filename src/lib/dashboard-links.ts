import type { Resource } from "@/lib/permissions";
import { reachesResource } from "@/lib/permission-reach";
import { HOME_UPCOMING_STATUSES } from "../../convex/lib/jobStatusGroups";

/**
 * Where every Home number goes (UX Phase 11, §6c.2, D85/D86). ONE table: a stat
 * tile, a Needs attention line and a widget's `View all ›` all read their href
 * and tooltip from here, so a tile's number always names the list it opens and
 * `dashboard-links.test.ts` can prove every href survives the target list's own
 * URL parser (a link the list silently ignores is the bug this replaces: three
 * of four tiles used to open a bare `/projects`).
 *
 * `resource` is the read a viewer needs to open the target. A `View all ›` whose
 * target the role can't open is absent, never a dead link.
 */
export interface DashboardLink {
  href: string;
  /** Names the target list, shown as the link's tooltip. */
  tip: string;
  resource?: Resource;
}

const JOBS = "/projects";

export const DASHBOARD_LINKS = {
  // ── Stat tiles ──
  activeJobs: { href: `${JOBS}?seg=active`, tip: "Jobs · Active", resource: "project" },
  overdueReturns: { href: `${JOBS}?overdue=1`, tip: "Jobs · Returns: Overdue", resource: "project" },
  gearDeployed: { href: "/assets/registry?status=CHECKED_OUT", tip: "Assets · Status: Out", resource: "asset" },
  crewBooked: { href: "/crew", tip: "Crew", resource: "crew" },
  // ── Needs attention lines ──
  subHireOverdue: { href: "/suppliers", tip: "Suppliers", resource: "supplier" },
  invoicesOverdue: { href: "/finance", tip: "Finance", resource: "invoice" },
  overbookings: { href: "/overbookings", tip: "Overbookings", resource: "project" },
  maintenanceDue: { href: "/maintenance", tip: "Maintenance", resource: "maintenance" },
  modelsDueForService: { href: "/maintenance/due", tip: "Maintenance · Due for service", resource: "maintenance" },
  crewOffers: { href: "/crew", tip: "Crew", resource: "crew" },
  quotes: { href: "/finance", tip: "Finance", resource: "invoice" },
  // ── View all › ──
  myTasks: { href: "/my-tasks", tip: "My tasks", resource: "project" },
  floor: { href: "/warehouse", tip: "Warehouse · the floor", resource: "warehouse" },
  // Upcoming lists quoted AND booked jobs: the list it opens must hold every row it showed.
  upcoming: { href: `${JOBS}?status=${HOME_UPCOMING_STATUSES.join(",")}`, tip: "Jobs · Quoted and Booked", resource: "project" },
  activity: { href: "/activity", tip: "Activity", resource: "reports" },
} as const satisfies Record<string, DashboardLink>;

/** A blocker line opens its job (the first one, when there are several). */
export function blockerLink(projectId: string): DashboardLink {
  return { href: `${JOBS}/${projectId}`, tip: "Job · Overview", resource: "project" };
}

/** Permission map as `useCurrentRole()` returns it (`null` while loading). */
type PermissionsLike = Partial<Record<Resource, readonly string[]>> | null | undefined;

/**
 * Can this viewer open the link's target? The SAME rule the shell uses to show a
 * page (`canSee` in `src/lib/nav.ts`): ANY action on the resource opens it. Not
 * literally `read`: `reports` grants `view`, so a read-only test left Activity's
 * `View all ›` dead for every role. Unknown permissions (still loading) = no.
 */
export function canOpenLink(link: DashboardLink, permissions: PermissionsLike): boolean {
  return !link.resource || reachesResource(permissions, link.resource);
}
