import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgPermission, requireService } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { applyProjectAllocation } from "./lib/allocation";
import { deriveBillingSummary } from "./lib/billingDerivation";
import type { AgentOpsAnnotations } from "./lib/agentOps";

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
    await assertWritesEnabled(ctx, "project"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
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

    const billingSummary = deriveBillingSummary({
      rentalStartMs: project.rentalStartDate,
      rentalEndMs: project.rentalEndDate,
      weeksOverride: project.billingWeeksOverride,
      daysOverride: project.billingDaysOverride,
    });
    await applyProjectAllocation(ctx, {
      projectId,
      orgId,
      billingWeeks: billingSummary.weeks,
      discountPercent: project.discountPercent,
      groups,
      lines,
      now,
    });

    return { ok: true as const, lines: lines.length };
  },
});

/**
 * Page through an org's project ids, for the backfill script.
 *
 * Paginated rather than collected: a large org's project table can exceed a single
 * query's read limit, and a backfill that silently stops at 16k projects would
 * leave a slice of the fleet reporting $0 forever. SERVICE-only — not a runtime read.
 */
export const listProjectIdsPage = query({
  args: { orgId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { orgId, cursor }) => {
    await requireService(ctx);
    const res = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .paginate({ cursor, numItems: 200 });
    return {
      ids: res.page.filter((p) => !p.isTemplate).map((p) => p.id),
      isDone: res.isDone,
      continueCursor: res.continueCursor,
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listProjectIdsPage: {
    agentAccess: "denied",
    reason:
      "Backfill-only pagination helper for scripts/convex-backfill-revenue-allocation.ts, not a runtime read; a raw project-id enumeration doesn't fit the normal resource/scope model and financial allocation detail is out of scope pending Phase 4's no_financials flag.",
  },
};
