import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Hotfix for #940 (WS1 — finance model): #940 removed `projects.depositPercent`
 * from the schema validator (deposit % moved to the client payment profile), but
 * never stripped the field from existing project documents — it was a real,
 * hand-typed wizard input pre-#940, not a dead/unused field. That broke the prod
 * Convex deploy: schema validation rejects a push where a live document has a
 * field the validator no longer declares. `convex/schema.ts` re-added the field
 * as `v.optional` (harmless round-trip, nothing reads/writes it) to unblock
 * deploys; this migration strips it so the field can be fully deleted from the
 * validator in a follow-up once every project has been paged.
 *
 * Same paginated-mutation + apply-flag shape as `backfillProjectWindow.ts`.
 * Idempotent — a project with no `depositPercent` is skipped. SERVICE-only.
 *
 * Driver: scripts/convex-backfill-strip-project-deposit-percent.ts.
 */
export const backfillStripProjectDepositPercentPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 300 });

    let scanned = 0;
    let updated = 0;
    for (const project of res.page) {
      if (project.depositPercent === undefined) continue;
      scanned++;
      if (!apply) continue;
      await ctx.db.patch(project._id, { depositPercent: undefined });
      updated++;
    }
    return { scanned, updated, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
