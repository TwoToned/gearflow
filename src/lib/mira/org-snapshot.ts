/**
 * A cheap, live "what's going on right now" snapshot fed into Mira's system
 * prompt so she has situational awareness without spending a tool-call
 * round-trip on it first. Reuses the SAME dashboard stat tiles the app's own
 * dashboard shows (`dashboardStats.bundle`, O(1) denormalised counters) — one
 * more `dispatch()` call under Mira's own token, so it's still bounded by
 * that user's RBAC (a role without `project:read` just gets none of this).
 */
export interface DashboardStatsBundle {
  totalAssets: number;
  checkedOutAssets: number;
  activeProjects: number;
  activeCrew: number;
  pendingCrewOffers: number;
  maintenanceDue: number;
  modelsDueForService: number;
  overdueReturns: number;
  countersReady: boolean;
}

export function formatOrgSnapshot(stats: DashboardStatsBundle): string {
  if (!stats.countersReady) return "";
  const lines = [
    `${stats.activeProjects} active project(s), ${stats.totalAssets} total asset units on file (${stats.checkedOutAssets} currently checked out).`,
    `${stats.activeCrew} active crew member(s)${stats.pendingCrewOffers ? `, ${stats.pendingCrewOffers} pending crew offer(s)` : ""}.`,
  ];
  const flags: string[] = [];
  if (stats.overdueReturns) flags.push(`${stats.overdueReturns} overdue return(s)`);
  if (stats.maintenanceDue) flags.push(`${stats.maintenanceDue} maintenance job(s) due`);
  if (stats.modelsDueForService) flags.push(`${stats.modelsDueForService} model(s) due for scheduled service`);
  if (flags.length) lines.push(`Needs attention: ${flags.join(", ")}.`);
  return lines.join(" ");
}
