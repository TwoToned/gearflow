import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { marginFromStored } from "./lib/margin";

/**
 * One-off backfill for the GST margin fix (UX Phase 10): `projects.margin` used to
 * be written as `total - costs`, and `total` includes GST. `recalcProjectTotals`
 * now writes `taxable - costs`, but a project keeps its old figure until it is next
 * recalculated. This rewrites ONLY `margin`, on the rows where it is wrong.
 *
 * - INTERNAL: not callable by a browser, a service token or an agent, and in
 *   neither the API registry nor `agentOps`. The owner runs it on the deployment
 *   after deploy (see FEATUREDOCS/66 "Post-deploy").
 * - IDEMPOTENT BY CONSTRUCTION: the right value is recomputed from the stored
 *   buckets through the SAME functions `recalcProjectTotals` uses
 *   (`taxableFrom`, `marginExGst`), never by adjusting the old margin; a second run
 *   finds every row already correct and patches nothing.
 * - NARROW: patches `margin` only (no other field, not `updatedAt`, no activity
 *   row), and never re-runs `recalcProjectTotals`, so a priced-under-lock or
 *   finance-locked job's money cannot move.
 * - Paginated by cursor; `numItems` defaults to 200.
 */
/** The right margin from the stored buckets, or `null` for a project never recalculated (nothing stored to correct). */
function correctMargin(p: Doc<"projects">): number | null {
  if (p.margin === undefined) return null;
  return marginFromStored(p);
}

export const backfillProjectMarginPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  returns: v.object({ scanned: v.number(), patched: v.number(), cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor, numItems }) => {
    // Clamped: a mistyped page size must not read an unbounded page.
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: Math.min(Math.max(Math.floor(numItems ?? 200), 1), 500) });
    let patched = 0;
    for (const p of res.page) {
      const correct = correctMargin(p);
      if (correct === null || p.margin === correct) continue;
      await ctx.db.patch(p._id, { margin: correct });
      patched++;
    }
    return { scanned: res.page.length, patched, cursor: res.continueCursor, isDone: res.isDone };
  },
});
