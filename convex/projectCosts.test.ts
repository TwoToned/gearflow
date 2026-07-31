// @vitest-environment node
//
// projectCosts.operationalCosts — browser-direct P&L (replaces the
// getProjectOperationalCosts server action). Verifies the margin arithmetic +
// project-scoped service-revenue / maintenance-cost aggregation + org isolation.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;
const USER = "user_1";
const makeT = () => convexTest(schema, modules);

const asUser = { subject: USER, orgId: ORG };

async function seedMember(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
  });
}

describe("projectCosts.operationalCosts", () => {
  test("computes margins from project fields + project-scoped services/maintenance", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Job",
        total: 1000, equipmentRevenue: 800, serviceCostTotal: 100, labourCostTotal: 50, subHireCostTotal: 25,
        createdAt: NOW, updatedAt: NOW,
      });
      // counted service (non-cancelled, has a charge set)
      await ctx.db.insert("projectServices", { id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Svc", status: "CONFIRMED", lineTotal: 200, createdAt: NOW, updatedAt: NOW });
      // excluded: cancelled (even though charged)
      await ctx.db.insert("projectServices", { id: "s2", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Svc", status: "CANCELLED", lineTotal: 999, createdAt: NOW, updatedAt: NOW });
      // excluded: no charge set (lineTotal unset) — billable is derived from the
      // charge, not a separate showOnDocuments flag
      await ctx.db.insert("projectServices", { id: "s3", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Svc", status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
      // maintenance: one counted, one cancelled
      await ctx.db.insert("maintenanceRecords", { id: "mr1", organizationId: ORG, projectId: "p1", type: "REPAIR", status: "SCHEDULED", title: "Fix", reportedById: USER, cost: 40, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("maintenanceRecords", { id: "mr2", organizationId: ORG, projectId: "p1", type: "REPAIR", status: "CANCELLED", title: "X", reportedById: USER, cost: 999, createdAt: NOW, updatedAt: NOW });
    });

    const r = await t.withIdentity(asUser).query(api.projectCosts.operationalCosts, { projectId: "p1", orgId: ORG });
    expect(r.serviceRevenue).toBe(200);
    expect(r.maintenanceCostTotal).toBe(40);
    expect(r.counts.maintenanceRecords).toBe(1);
    // allCosts = 100+50+25+40 = 215; netMargin = 1000-215 = 785; margin% = 78.5
    expect(r.netMargin).toBe(785);
    expect(r.marginPercent).toBeCloseTo(78.5, 5);
  });

  test("WS11 (#950): saleRevenue/saleCostTotal read straight off the project row, and saleCostTotal counts toward netMargin", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Job",
        total: 1000, equipmentRevenue: 700, saleRevenue: 300, saleCostTotal: 120,
        serviceCostTotal: 0, labourCostTotal: 0, subHireCostTotal: 0,
        createdAt: NOW, updatedAt: NOW,
      });
    });
    const r = await t.withIdentity(asUser).query(api.projectCosts.operationalCosts, { projectId: "p1", orgId: ORG });
    expect(r.saleRevenue).toBe(300);
    expect(r.saleCostTotal).toBe(120);
    // allCosts = 120 (only saleCostTotal is non-zero); netMargin = 1000-120 = 880
    expect(r.netMargin).toBe(880);
  });

  test("returns empty for a project in another org (no cross-tenant leak)", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "pX", organizationId: OTHER, projectNumber: "P-X", name: "Other", total: 5000, createdAt: NOW, updatedAt: NOW });
    });
    const r = await t.withIdentity(asUser).query(api.projectCosts.operationalCosts, { projectId: "pX", orgId: ORG });
    expect(r.total).toBe(0);
    expect(r.netMargin).toBe(0);
  });
});
