import { v } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { collectCapped } from "./lib/pagination";
import { applyPerOrgFairnessCap } from "./lib/cronFairness";
import { resolveCurrentDueDate } from "./lib/serviceScheduleCore";
import { resolveModelAssetType } from "./lib/availabilityCore";

/**
 * WS6 #945 — daily cron generator for recurring preventative maintenance
 * cycles. Registered in `convex/crons.ts` at 22:00 UTC, `internal.
 * maintenanceScheduleGeneration.generateDueCycles`. NATIVE Convex
 * internalMutation — deliberately NOT the HTTP-hop pattern
 * `scheduledJobs.ts`'s other two crons use: this job only ever reads
 * `serviceSchedules`/`models`/`assets`/`bulkAssets` and writes
 * `maintenanceRecords`, all Convex tables, so there is no Postgres/Better-Auth
 * dependency to route through the Next.js route for (unlike the email crons,
 * which need Postgres for recipients). Gated behind `ENABLE_CONVEX_CRONS` for
 * the same off-by-default rollout discipline as the other two crons, even
 * though it has no HTTP call of its own to gate.
 *
 * ── THE NON-BLOCKING INVARIANT (hard, do not weaken) ──
 * This mutation NEVER writes `asset.status`, `bulkAsset.availableQuantity`, or
 * anything `computeStockBreakdown`/availability reads. It only inserts/patches
 * `maintenanceRecords` rows at `status: "SCHEDULED"` (the one status the
 * existing hold/release state machine in `maintenanceWrites.ts` already treats
 * as non-holding) — mirroring the `checkPredictiveMaintenanceCore.ts` precedent
 * this workstream was told to follow. See `maintenanceScheduleGeneration.
 * test.ts`'s `computeStockBreakdown` byte-identical regression test.
 *
 * ── Merge semantics ("single open cycle per schedule", spec decision) ──
 * At most one maintenanceRecords row per schedule is ever in a non-terminal
 * state (status outside COMPLETED/CANCELLED). Each run, per active schedule:
 *   1. Resolve the current due date from the fixed anchor+interval math.
 *      Not due yet -> skip.
 *   2. If an OPEN cycle already exists for this schedule:
 *        - its scheduledDate already equals the current due date -> idempotent
 *          no-op (a same-day re-run, or the cron ticking again before the next
 *          interval).
 *        - otherwise the org fell behind (the due date advanced while the
 *          previous cycle was still open/incomplete) -> MERGE forward: patch
 *          the SAME row's scheduledDate to the new due date rather than
 *          stacking a second open row. `poolQuantitySnapshot` and any
 *          already-recorded CHECKOFF progress are left untouched — they
 *          describe real work already done under this cycle.
 *   3. No open cycle (previous was completed, or this is the first-ever
 *      cycle) -> the (serviceScheduleId, dueDate) idempotency key is checked
 *      directly (covers same-day re-runs right after a completion) and, if
 *      absent, a new SCHEDULED/PREVENTATIVE record is created with a freshly
 *      computed `poolQuantitySnapshot`.
 */

// Per-org fairness bound (#1077, A7): well above any realistic single-org
// schedule count (one row per model+cadence), but bounded so one high-volume
// tenant can never fully consume the shared collectCapped budget below and
// starve every other org's cycle generation out of every run.
const MAX_SCHEDULES_PER_ORG_PER_TICK = 500;

const TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

function isOpenStatus(status: string | undefined): boolean {
  return !TERMINAL_STATUSES.has(status ?? "SCHEDULED");
}

/**
 * The pool denominator for a model's PM cycle: unit count for SERIALIZED,
 * summed active totalQuantity for BULK — mirrors `computeStockBreakdown`'s
 * own totalStock math (`convex/lib/availabilityCore.ts`), but this is
 * DELIBERATELY a separate read (not a call into availabilityCore) — it is
 * NEVER used for any availability/booking decision, only to freeze a "N of
 * total" denominator for the worklist's progress display.
 */
async function computePoolQuantitySnapshot(ctx: MutationCtx, model: Doc<"models">): Promise<number> {
  const [assetsRaw, bulkRaw] = await Promise.all([
    ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", model.id)).collect(),
    ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", model.id)).collect(),
  ]);
  const activeAssets = assetsRaw.filter((a) => a.organizationId === model.organizationId && a.isActive !== false);
  const activeBulk = bulkRaw.filter((b) => b.organizationId === model.organizationId && b.isActive !== false);
  const assetType = resolveModelAssetType(model.assetType, activeBulk.length > 0, activeAssets.length > 0);
  if (assetType === "BULK") {
    return activeBulk.reduce((sum, b) => sum + (b.totalQuantity ?? 0), 0);
  }
  return activeAssets.length;
}

/**
 * Bounded, fair read of due-cycle candidates (#1077, A7). serviceSchedules is
 * a small, admin-created catalog table (one row per model+cadence) with no
 * per-cron orgId to scope by — collectCapped bounds the platform-wide sweep
 * instead of an unindexed full collect (R-9.8). A single global cap alone
 * isn't FAIR across tenants though: if one org supplies most of the rows
 * within that budget, every other org's schedules get starved out of every
 * run, forever (same prefix read every tick). applyPerOrgFairnessCap
 * post-filters so no one org can contribute more than its share — capped
 * rows are picked up next run, same "truncated, retried later" semantics as
 * the overall cap. Split out of the handler to keep its own branch count
 * under the R-3.6 ceiling.
 */
async function readSchedulesFairly(ctx: MutationCtx) {
  const { rows: rawSchedules, truncated } = await collectCapped(ctx.db.query("serviceSchedules"));
  const { rows: schedules, cappedOrgIds } = applyPerOrgFairnessCap(rawSchedules, MAX_SCHEDULES_PER_ORG_PER_TICK);
  if (truncated) {
    console.warn(
      "[maintenance-schedule-generation] serviceSchedules truncated at the collect cap — some schedules were skipped this run and will be picked up on a later run.",
    );
  }
  if (cappedOrgIds.size > 0) {
    console.warn(
      `[maintenance-schedule-generation] per-org fairness cap hit for ${cappedOrgIds.size} org(s) — some of their schedules were skipped this run and will be picked up on a later run.`,
    );
  }
  return schedules;
}

export const generateDueCycles = internalMutation({
  args: {},
  returns: v.object({
    skipped: v.optional(v.boolean()),
    scanned: v.number(),
    created: v.number(),
    merged: v.number(),
    noop: v.number(),
  }),
  handler: async (ctx) => {
    if (process.env.ENABLE_CONVEX_CRONS !== "true") {
      console.log("[maintenance-schedule-generation] disabled (ENABLE_CONVEX_CRONS != \"true\") — skipping");
      return { skipped: true, scanned: 0, created: 0, merged: 0, noop: 0 };
    }

    const now = Date.now();
    const schedules = await readSchedulesFairly(ctx);

    let created = 0;
    let merged = 0;
    let noop = 0;

    for (const schedule of schedules) {
      if (schedule.isActive === false) continue;

      const dueDate = resolveCurrentDueDate(schedule.anchorDate, schedule.intervalMonths, now);
      if (dueDate === null) continue; // schedule's anchor is still in the future

      const cyclesForSchedule = await ctx.db
        .query("maintenanceRecords")
        .withIndex("by_serviceScheduleId", (q) => q.eq("serviceScheduleId", schedule.id))
        .collect();
      const open = cyclesForSchedule.find((r) => isOpenStatus(r.status));

      if (open) {
        if (open.scheduledDate === dueDate) {
          noop++; // idempotent: already generated for this exact cycle
          continue;
        }
        // Merge forward — single open cycle per schedule, no stacking.
        await ctx.db.patch(open._id, { scheduledDate: dueDate, updatedAt: now });
        merged++;
        continue;
      }

      // No open cycle. Idempotency key check for the exact (schedule, dueDate)
      // pair — covers a same-day re-run right after the prior cycle completed.
      const already = await ctx.db
        .query("maintenanceRecords")
        .withIndex("by_serviceScheduleId_scheduledDate", (q) =>
          q.eq("serviceScheduleId", schedule.id).eq("scheduledDate", dueDate),
        )
        .first();
      if (already) {
        noop++;
        continue;
      }

      const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", schedule.modelId)).unique();
      if (!model || model.organizationId !== schedule.organizationId) {
        noop++; // orphaned schedule (model deleted / cross-org) — nothing to generate against
        continue;
      }

      const poolQuantitySnapshot = await computePoolQuantitySnapshot(ctx, model);
      const recordId = createId();
      await ctx.db.insert("maintenanceRecords", {
        id: recordId,
        organizationId: schedule.organizationId,
        type: "PREVENTATIVE",
        // SCHEDULED — the ONE status the hold/release state machine treats as
        // non-holding (maintenanceWrites.ts HOLDING_STATUSES). Never anything else here.
        status: "SCHEDULED",
        title: `${schedule.name} — ${model.name}`,
        description: schedule.instructions || undefined,
        scheduledDate: dueDate,
        serviceScheduleId: schedule.id,
        poolQuantitySnapshot,
        createdAt: now,
        updatedAt: now,
      });
      created++;
    }

    return { scanned: schedules.length, created, merged, noop };
  },
});
