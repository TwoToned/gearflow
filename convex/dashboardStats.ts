import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";
import { readCounterValues, ZERO_COUNTERS } from "./dashboardCounters";

/**
 * BROWSER-facing native replacement for getDashboardStats (Phase 3). Returns the
 * seven dashboard stats reactively:
 *   • the six denormalised counters read O(1) from `dashboardCounters` (no asset/
 *     line-item registry scan — the migration's top Convex-limit risk), and
 *   • the two DATE-DERIVED metrics (maintenanceDue, overdueReturns) computed at
 *     read from bounded indexed queries — nothing writes at the moment a date
 *     passes, so these can't be counters. `now` is passed (minute-bucketed by the
 *     client) so the subscription is stable yet refreshes each minute.
 *
 * Gated on requireOrgRead (org-scoping — matches getDashboardStats' getOrgContext;
 * the dashboard is visible to every org member).
 */

const RETURN_TERMINAL = new Set(["RETURNED", "COMPLETED", "INVOICED", "CANCELLED"]);
const OPEN_MAINTENANCE = new Set(["SCHEDULED", "IN_PROGRESS"]);

export const bundle = query({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgRead(ctx, orgId);

    // `countersReady` = the SHARDED counters have been seeded (row.shardsSeededAt),
    // NOT mere row existence — a legacy pre-migration row exists but its shards are
    // unseeded, so its sums would be wrong-zeros. When not ready, return zeros +
    // countersReady:false; the client (useNativeDashboardStats) treats that as a
    // loading state (StatTile skeletons) rather than showing the zeros.
    const counterRow = await ctx.db
      .query("dashboardCounters")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .first();
    const ready = counterRow?.shardsSeededAt != null;
    const counter = ready ? await readCounterValues(ctx, orgId) : ZERO_COUNTERS;

    // ── Date-derived: maintenanceDue (open + scheduledDate arrived) ──
    const maintenance = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    const maintenanceDue = maintenance.filter(
      (m) => OPEN_MAINTENANCE.has(m.status ?? "") && m.scheduledDate != null && (m.scheduledDate as number) <= now,
    ).length;

    // ── Date-derived: overdueReturns (CHECKED_OUT line items in overdue projects) ──
    // Overdue = non-template project past its rentalEndDate, not in a terminal
    // status. The overdue set is small; read CHECKED_OUT line items per overdue
    // project via by_projectId_status (bounded), NOT the whole org's line items.
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    const overdueProjectIds = projects
      .filter(
        (p) =>
          p.isTemplate !== true &&
          p.rentalEndDate != null &&
          (p.rentalEndDate as number) < now &&
          !RETURN_TERMINAL.has(p.status ?? ""),
      )
      .map((p) => p.id);

    let overdueReturns = 0;
    if (overdueProjectIds.length > 0) {
      const perProject = await Promise.all(
        overdueProjectIds.map((pid) =>
          ctx.db
            .query("projectLineItems")
            .withIndex("by_projectId_status", (q) => q.eq("projectId", pid).eq("status", "CHECKED_OUT"))
            .collect(),
        ),
      );
      overdueReturns = perProject.reduce((sum, rows) => sum + rows.length, 0);
    }

    return {
      totalAssets: counter.activeAssets + counter.bulkQuantity,
      checkedOutAssets: counter.checkedOutAssets,
      activeProjects: counter.activeProjects,
      activeCrew: counter.activeCrew,
      pendingCrewOffers: counter.pendingCrewOffers,
      maintenanceDue,
      overdueReturns,
      // False until the sharded counters are seeded, so the client shows a loading
      // state instead of wrong-zeros mid-migration (see useNativeDashboardStats).
      countersReady: ready,
    };
  },
});
