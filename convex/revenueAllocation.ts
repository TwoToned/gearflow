import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { applyProjectAllocation } from "./lib/allocation";

/**
 * Recompute a project's revenue allocation on its own.
 *
 * The NATIVE recalc path (convex/lib/recalc.ts, behind NATIVE_RECALC) allocates
 * inline off the reads it already did — one backend-local mutation, no extra hop.
 * The LEGACY server-side `recalculateProjectTotals` can't do that, so it calls this
 * afterwards. Both paths therefore allocate, and flipping the flag changes latency,
 * never the numbers.
 *
 * Also used by scripts/convex-backfill-revenue-allocation.ts to populate historical
 * projects, which is the only reason it's exported rather than internal.
 */
export const recomputeForProject = mutation({
  args: {
    projectId: v.string(),
    orgId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { projectId, orgId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");

    const project = await ctx.db
      .query("projects")
      .withIndex("by_cuid", (q) => q.eq("id", projectId))
      .first();
    if (!project) throw new ConvexError(`project not found: ${projectId}`);
    if (project.organizationId !== orgId) {
      throw new ConvexError(`project ${projectId} is not in org ${orgId}`);
    }

    const [groups, lines] = await Promise.all([
      ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ]);

    await applyProjectAllocation(ctx, {
      projectId,
      orgId,
      rentalPeriod: project.defaultRentalPeriod,
      groups,
      lines,
      now,
    });

    return { ok: true as const, lines: lines.length };
  },
});
