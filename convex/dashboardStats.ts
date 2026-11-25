import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import { readCounterValues, ZERO_COUNTERS } from "./dashboardCounters";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { overdueReturnsForOrg } from "./lib/overdueReturns";
import { OVERDUE_MAINTENANCE_STATUSES, isOverdueMaintenance, overdueCutoff } from "./lib/maintenanceOpen";

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
 * Gated on requireOrgReadFor(ctx, orgId, "project") (org-scoping — matches
 * getDashboardStats' getOrgContext; the dashboard is visible to every org member;
 * Phase 5 domain slice, #1001).
 */

// Overdue maintenance is ONE definition (lib/maintenanceOpen.ts), the Maintenance
// page's own Overdue tile.
// A range `.lte`/`.lt(now)` sweeps in rows whose date field is undefined (undefined
// sorts before all numbers in a Convex index). Pin the lower bound at the minimum
// representable timestamp so undated rows stay OUT of the read-set entirely (matters
// for date-less draft/quote projects), keeping the reactive read-set minimal.
const MIN_TS = -8_640_000_000_000_000;

/** Per overdue status, the most late maintenance records Home reads (then `n+`). */
export const MAINTENANCE_DUE_CAP = 500;

export const bundle = query({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)

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

    // ── Date-derived: maintenanceDue = the Maintenance page's Overdue tile ──
    // The ONE overdue rule (lib/maintenanceOpen.ts `isOverdueMaintenance`):
    // scheduled / in progress with `scheduledDate < now`; held work (awaiting
    // parts, QA) is not late. Like the page's tile it counts EVERY record,
    // schedule-generated PM cycles included, so the Needs attention line and the
    // page it opens say the same number. Range-scan by (org, status, MIN_TS <
    // scheduledDate < now) per overdue status so the reactive read-set is only
    // the dated-and-late records (Appendix B); the lower bound keeps undated rows out.
    //
    // WS6 #945: the schedule-generated cycles ALSO feed the model-level
    // "N models due for service" line (modelsDueForService below), which opens
    // Due for service — a different list, so the two lines can overlap.
    // Bounded: each status range is org-index-first, oldest first, capped at
    // MAINTENANCE_DUE_CAP + 1; a hit sets `maintenanceTruncated` (the line prints n+).
    let maintenanceDue = 0;
    let maintenanceTruncated = false;
    const dueForServiceModelIds = new Set<string>();
    for (const status of OVERDUE_MAINTENANCE_STATUSES) {
      const read = await ctx.db
        .query("maintenanceRecords")
        .withIndex("by_organizationId_status_scheduledDate", (q) =>
          q.eq("organizationId", orgId).eq("status", status).gt("scheduledDate", MIN_TS).lt("scheduledDate", overdueCutoff(now)),
        )
        .take(MAINTENANCE_DUE_CAP + 1);
      if (read.length > MAINTENANCE_DUE_CAP) maintenanceTruncated = true;
      for (const r of read.slice(0, MAINTENANCE_DUE_CAP)) {
        if (!isOverdueMaintenance(r, now)) continue;
        maintenanceDue++;
        if (!r.serviceScheduleId) continue;
        const schedule = await ctx.db
          .query("serviceSchedules")
          .withIndex("by_cuid", (q) => q.eq("id", r.serviceScheduleId!))
          .unique();
        // by_cuid is global: the schedule must be this org's.
        if (schedule && schedule.organizationId === orgId) dueForServiceModelIds.add(schedule.modelId);
      }
    }
    const modelsDueForService = dueForServiceModelIds.size;

    // ── Date-derived: overdue returns (D85) ──
    // The ONE definition lives in `lib/overdueReturns.ts` (shared with the Jobs
    // list's `overdue=1` filter and its Needs-you set, so the tile's number is
    // the list it opens). It reads the org's OPEN jobs by (org, status), then
    // probes each past-end job's LIVE version for CHECKED_OUT lines, bounded,
    // with a `truncated` flag.
    // The tile's sub-line counts the lines still out, so this caller counts them.
    const overdue = await overdueReturnsForOrg(ctx, orgId, now, { countLines: true });

    return {
      totalAssets: counter.activeAssets + counter.bulkQuantity,
      checkedOutAssets: counter.checkedOutAssets,
      activeProjects: counter.activeProjects,
      activeCrew: counter.activeCrew,
      pendingCrewOffers: counter.pendingCrewOffers,
      maintenanceDue,
      // A per-status range hit MAINTENANCE_DUE_CAP: maintenanceDue (and
      // modelsDueForService) are lower bounds.
      maintenanceTruncated,
      // WS6 #945 — distinct models with an overdue (scheduled or in-progress)
      // recurring PM cycle. Model-level and opens Due for service; those cycles
      // are ALSO in `maintenanceDue`, which mirrors the Maintenance page's tile.
      modelsDueForService,
      // D85: the tile counts JOBS; `overdueReturns` (CHECKED_OUT lines on those
      // jobs) is kept, unchanged in name, as the tile's sub-line ("67 items to chase").
      overdueReturns: overdue.lineCount,
      overdueReturnJobs: overdue.projectIds.size,
      overdueTruncated: overdue.truncated,
      // False until the sharded counters are seeded, so the client shows a loading
      // state instead of wrong-zeros mid-migration (see useNativeDashboardStats).
      countersReady: ready,
    };
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  bundle: { summary: "The org's dashboard stat tiles (assets, projects, crew, maintenance due, overdue returns as jobs and lines).", danger: "low", mcpTier: 2 },
};
