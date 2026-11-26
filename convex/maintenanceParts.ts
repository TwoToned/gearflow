import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { canSeeJobCost } from "./lib/crewPayVisibility";
import { collectCapped } from "./lib/pagination";
import { resolveNow } from "./lib/projectSegments";
import { maintenanceCost, partsSummary } from "./lib/maintenanceCost";

/**
 * The Parts tab's read (UX Phase 14, 14b-3, D76): the parts of ONE maintenance record, the derived parts summary
 * (`on order`, `arrived`, next ETA, late) and the derived COST (parts + labour). Money follows the job-cost line: a
 * caller who cannot see job cost gets the parts with NO price and no cost figures (absent, never zeroed), the
 * summary (which carries no money) stays. `by_maintenanceRecordId` is global, so the org is re-checked per row.
 */
export const listForRecord = query({
  args: { orgId: v.string(), recordId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "maintenance");
    const rec = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", a.recordId)).first();
    if (!rec || rec.organizationId !== a.orgId) throw new ConvexError("Maintenance record not found");
    const seesCost = await canSeeJobCost(ctx, a.orgId);
    const rows = await collectCapped(ctx.db.query("maintenanceParts").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", a.recordId)), 201);
    const parts = rows.rows
      .filter((p) => p.organizationId === a.orgId)
      .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0) || x.name.localeCompare(y.name))
      .map((p) => ({
        id: p.id,
        name: p.name,
        supplierName: p.supplierName ?? null,
        quantity: p.quantity,
        etaDate: p.etaDate ?? null,
        arrivedAt: p.arrivedAt ?? null,
        ...(seesCost ? { unitPrice: p.unitPrice ?? null } : {}),
      }));
    const summary = partsSummary(rows.rows.filter((p) => p.organizationId === a.orgId), resolveNow(a.now));
    const cost = seesCost ? maintenanceCost(rec.cost, rows.rows.filter((p) => p.organizationId === a.orgId)) : null;
    return { parts, summary, cost, truncated: rows.truncated };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForRecord: { summary: "The parts of one maintenance job with the derived parts summary and cost (price and cost only for callers who can see job cost)." },
};
