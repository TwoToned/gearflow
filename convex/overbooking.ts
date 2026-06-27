import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * ONE-round-trip read of everything `computeOverbookedStatus` needs: for the given
 * models — the line items (across all projects, for booking overlap) + active
 * assets + bulk assets (for the stock breakdown) — plus all org projects (for the
 * date-window join) and all org models. Replaces ~5 separate server→Convex queries
 * in 2 waves with one backend-local query. Raw docs; the JS (sumBookingsByModel +
 * computeStockBreakdown) stays in src/lib (parity-by-construction). requireOrgRead
 * matches every constituent read's boundary (none were service-only).
 */
export const bundle = query({
  args: { orgId: v.string(), modelIds: v.array(v.string()) },
  handler: async (ctx, { orgId, modelIds }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(modelIds)];
    // Matches the old assets/bulkAssets/projectLineItems.listByModelIds cap — guards
    // against an unbounded 3*N index fan-out hitting Convex read/time limits.
    if (unique.length > 1000) {
      throw new ConvexError("overbooking.bundle: too many modelIds (" + unique.length + " > 1000)");
    }

    const [lineItemGroups, assetGroups, bulkGroups, projects, models] = await Promise.all([
      Promise.all(unique.map((mid) => ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
      Promise.all(unique.map((mid) => ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
      Promise.all(unique.map((mid) => ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
      ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ]);

    return {
      lineItems: lineItemGroups.flat().filter((r) => r.organizationId === orgId),
      assets: assetGroups.flat().filter((r) => r.organizationId === orgId),
      bulkAssets: bulkGroups.flat().filter((r) => r.organizationId === orgId),
      projects,
      models,
    };
  },
});
