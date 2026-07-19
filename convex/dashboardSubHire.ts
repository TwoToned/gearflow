import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * BROWSER-facing native replacement for getSubHireDashboardStats (Phase 3). The
 * org's sub-hire heads are bounded (far fewer than the asset registry), so this
 * reads them by_organizationId and aggregates the three stats — reactive, no
 * counter needed. `now` + `monthStart` are client-passed (queries can't read the
 * clock). Gated on requireOrgRead (org-scoping — matches getOrgContext).
 */
export const bundle = query({
  args: { orgId: v.string(), now: v.number(), monthStart: v.number() },
  handler: async (ctx, { orgId, now, monthStart }) => {
    await requireOrgRead(ctx, orgId);
    const subHires = await ctx.db
      .query("subHires")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reviewed, accepted R-9.8 tradeoff over the org set (aggregation/enrichment)
      .collect();

    const activeSubHires = subHires.filter(
      (sh) => sh.status === "CONFIRMED" || sh.status === "ON_HIRE",
    ).length;

    const monthlySubHireCost = subHires
      .filter((sh) => sh.status !== "CANCELLED" && sh.hireStart != null && (sh.hireStart as number) >= monthStart)
      .reduce((sum, sh) => sum + (sh.totalCost ?? 0), 0);

    const overdueReturns = subHires.filter(
      (sh) => sh.status === "ON_HIRE" && sh.hireEnd != null && (sh.hireEnd as number) < now,
    ).length;

    return { activeSubHires, monthlySubHireCost, overdueReturns };
  },
});
