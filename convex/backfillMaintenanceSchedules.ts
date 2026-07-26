import { v } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import { daysToNearestMonths } from "./lib/serviceScheduleCore";

/**
 * WS6 #945 — one-time migrate backfill for `models.maintenanceIntervalDays`
 * (DEPRECATED, see the schema.ts comment on that field). Seeds one
 * `serviceSchedules` row per model that had a positive interval set, days
 * converted to the nearest whole month (`daysToNearestMonths`). The anchor
 * date is the migration run time — there is no historical "last serviced"
 * date in the old field to anchor from, so the first cycle becomes due one
 * full interval after the backfill runs.
 *
 * Idempotent — skips any model that ALREADY has a `serviceSchedules` row (a
 * schedule created manually post-widen, or a prior run of this backfill), so
 * re-runs never duplicate. `apply=false` is a dry-run that only counts.
 *
 * SERVICE-only, paginated (one query can't scan a large table — mirrors
 * backfillClientContacts.ts). Driver: scripts/convex-backfill-maintenance-
 * schedules.ts (pages the cursor until isDone).
 *
 * NOT run automatically as part of this PR/deploy — an operator runs the
 * driver script once against the target deployment BEFORE (or as part of)
 * shipping the model-form field removal, matching the WS9 clientContacts
 * widen/migrate-then-narrow precedent.
 */
export const backfillMaintenanceSchedulesPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, apply, numItems, now }) => {
    await requireService(ctx);
    const res = await ctx.db.query("models").paginate({ cursor, numItems: numItems ?? 300 });
    const nowMs = now ?? Date.now();

    let scanned = 0;
    let created = 0;
    for (const model of res.page) {
      const days = model.maintenanceIntervalDays;
      if (!days || days <= 0) continue;

      const already = await ctx.db.query("serviceSchedules").withIndex("by_modelId", (q) => q.eq("modelId", model.id)).first();
      if (already) continue;

      scanned++; // a model that NEEDS a backfilled schedule
      if (!apply) continue;

      await ctx.db.insert("serviceSchedules", {
        id: createId(),
        organizationId: model.organizationId,
        modelId: model.id,
        name: "Scheduled service",
        intervalMonths: daysToNearestMonths(days),
        anchorDate: nowMs,
        isActive: true,
        createdAt: nowMs,
        updatedAt: nowMs,
      });
      created++;
    }
    return { scanned, created, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
