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
const OPEN_MAINTENANCE_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const;
// A range `.lte`/`.lt(now)` sweeps in rows whose date field is undefined (undefined
// sorts before all numbers in a Convex index). Pin the lower bound at the minimum
// representable timestamp so undated rows stay OUT of the read-set entirely (matters
// for date-less draft/quote projects), keeping the reactive read-set minimal.
const MIN_TS = -8_640_000_000_000_000;

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
    // Range-scan by (org, status, MIN_TS < scheduledDate <= now) per open status so
    // the reactive read-set is only the dated-and-due records, not the whole
    // maintenance table (Appendix B). The lower bound keeps undated rows out.
    //
    // WS6 #945: schedule-generated PM cycles (serviceScheduleId set) are
    // EXCLUDED from this count — they get their own "N models due for service"
    // chip (modelsDueForService below) instead of double-counting into the
    // legacy ad-hoc-maintenance tile (see FEATUREDOCS/17's chip note).
    let maintenanceDue = 0;
    const dueForServiceModelIds = new Set<string>();
    for (const status of OPEN_MAINTENANCE_STATUSES) {
      const due = await ctx.db
        .query("maintenanceRecords")
        .withIndex("by_organizationId_status_scheduledDate", (q) =>
          q.eq("organizationId", orgId).eq("status", status).gt("scheduledDate", MIN_TS).lte("scheduledDate", now),
        )
        .collect();
      for (const r of due) {
        if (!r.serviceScheduleId) {
          maintenanceDue++;
          continue;
        }
        const schedule = await ctx.db
          .query("serviceSchedules")
          .withIndex("by_cuid", (q) => q.eq("id", r.serviceScheduleId!))
          .unique();
        if (schedule) dueForServiceModelIds.add(schedule.modelId);
      }
    }
    const modelsDueForService = dueForServiceModelIds.size;

    // ── Date-derived: overdueReturns (CHECKED_OUT line items in overdue projects) ──
    // Overdue = non-template project past its rentalEndDate, not in a terminal
    // status. Range-scan by (org, MIN_TS < rentalEndDate < now) so the reactive
    // read-set is only past-end-date projects, not the whole org's projects table
    // (Appendix B); the lower bound keeps date-less draft/quote projects out. Then
    // read CHECKED_OUT line items per overdue project via by_projectId_status
    // (bounded), NOT the whole org's line items.
    const overdueProjects = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_rentalEndDate", (q) =>
        q.eq("organizationId", orgId).gt("rentalEndDate", MIN_TS).lt("rentalEndDate", now),
      )
      .collect();
    const overdueProjectIds = overdueProjects
      .filter(
        (p) =>
          p.isTemplate !== true &&
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
      // WS6 #945 — distinct models with an open, due (or in-progress) recurring
      // PM cycle. Separate from `maintenanceDue` by design (see the exclusion
      // note above) so the two chips never double-count the same work.
      modelsDueForService,
      overdueReturns,
      // False until the sharded counters are seeded, so the client shows a loading
      // state instead of wrong-zeros mid-migration (see useNativeDashboardStats).
      countersReady: ready,
    };
  },
});
