import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgPermission, getAuthContext, isAgentNoFinancials } from "./lib/auth";

/**
 * Operational P&L for a project (Phase 3 browser-direct — replaces the
 * `getProjectOperationalCosts` server action / `computeProjectOperationalCosts`
 * Node helper). Same arithmetic, but project-scoped: services + maintenance are read
 * by `by_projectId` (not the org-wide scan the server helper did), so the reactive
 * read-set stays narrow (Appendix B). Browser-callable via `requireOrgPermission`
 * (service tokens — PDF/CSV — pass too).
 */

const costsShape = {
  equipmentRevenue: v.number(),
  // WS11 (#950) — sale revenue/COGS bucket, additive alongside the existing ones.
  saleRevenue: v.number(),
  saleCostTotal: v.number(),
  serviceRevenue: v.number(),
  // Additive (WS10 #949 labour charge rates & margin): the slice of serviceRevenue
  // billed for LABOUR-type services specifically — non-zero only once a crew role
  // (or per-service override) has a charge rate configured, so the "Labour" row
  // can show revenue alongside its existing cost once auto-pricing exists. See
  // ProjectCostsPanel.
  labourServiceRevenue: v.number(),
  total: v.number(),
  serviceCostTotal: v.number(),
  labourCostTotal: v.number(),
  subHireCostTotal: v.number(),
  maintenanceCostTotal: v.number(),
  netMargin: v.number(),
  marginPercent: v.number(),
  counts: v.object({ maintenanceRecords: v.number() }),
};

const EMPTY = {
  equipmentRevenue: 0,
  saleRevenue: 0,
  saleCostTotal: 0,
  serviceRevenue: 0,
  labourServiceRevenue: 0,
  total: 0,
  serviceCostTotal: 0,
  labourCostTotal: 0,
  subHireCostTotal: 0,
  maintenanceCostTotal: 0,
  netMargin: 0,
  marginPercent: 0,
  counts: { maintenanceRecords: 0 },
};

export const operationalCosts = query({
  args: { projectId: v.string(), orgId: v.string() },
  returns: v.object(costsShape),
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");

    // Decision 6 (#1002) — a `noFinancials` agent key never sees cost/margin,
    // regardless of the acting user's role. Checked AFTER the RBAC gate (so a
    // key without project:read still gets FORBIDDEN, not a quiet zero) and
    // BEFORE any computation, so nothing costed is ever assembled for it.
    const auth = await getAuthContext(ctx);
    if (await isAgentNoFinancials(ctx, auth)) return EMPTY;

    const project = await ctx.db
      .query("projects")
      .withIndex("by_cuid", (q) => q.eq("id", projectId))
      .first();
    if (!project || project.organizationId !== orgId) return EMPTY;

    // Service revenue: mirrors sumProjectServiceRevenue (non-cancelled, shown on docs).
    const services = await ctx.db
      .query("projectServices")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    let serviceRevenue = 0;
    let labourServiceRevenue = 0;
    for (const s of services) {
      if (s.organizationId !== orgId) continue; // defence-in-depth (by_projectId is not org-scoped)
      if (s.status === "CANCELLED") continue;
      if (s.showOnDocuments !== true) continue;
      serviceRevenue += s.lineTotal ?? 0;
      if (s.type === "LABOUR") labourServiceRevenue += s.lineTotal ?? 0;
    }

    // Maintenance cost: mirrors aggregateMaintenanceForProject (non-cancelled).
    const maintenance = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    let maintenanceCostTotal = 0;
    let maintenanceCount = 0;
    for (const m of maintenance) {
      if (m.organizationId !== orgId) continue;
      if (m.status === "CANCELLED") continue;
      maintenanceCount += 1;
      maintenanceCostTotal += m.cost ?? 0;
    }

    const equipmentRevenue = Number(project.equipmentRevenue ?? 0);
    // WS11 (#950) — persisted by recalcProjectTotals (convex/lib/recalc.ts),
    // same pattern as every other bucket read straight off the project row.
    const saleRevenue = Number(project.saleRevenue ?? 0);
    const saleCostTotal = Number(project.saleCostTotal ?? 0);
    const total = Number(project.total ?? 0);
    const serviceCostTotal = Number(project.serviceCostTotal ?? 0);
    const labourCostTotal = Number(project.labourCostTotal ?? 0);
    const subHireCostTotal = Number(project.subHireCostTotal ?? 0);

    const allCosts = serviceCostTotal + labourCostTotal + subHireCostTotal + maintenanceCostTotal + saleCostTotal;
    const netMargin = total - allCosts;
    const marginPercent = total > 0 ? Math.max(0, Math.min(100, (netMargin / total) * 100)) : 0;

    return {
      equipmentRevenue,
      saleRevenue,
      saleCostTotal,
      serviceRevenue,
      labourServiceRevenue,
      total,
      serviceCostTotal,
      labourCostTotal,
      subHireCostTotal,
      maintenanceCostTotal,
      netMargin,
      marginPercent,
      counts: { maintenanceRecords: maintenanceCount },
    };
  },
});
