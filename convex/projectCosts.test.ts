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
      // counted service (non-cancelled, shown on docs)
      await ctx.db.insert("projectServices", { id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Svc", status: "CONFIRMED", showOnDocuments: true, lineTotal: 200, createdAt: NOW, updatedAt: NOW });
      // excluded: cancelled + not-on-docs
      await ctx.db.insert("projectServices", { id: "s2", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Svc", status: "CANCELLED", showOnDocuments: true, lineTotal: 999, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectServices", { id: "s3", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Svc", status: "CONFIRMED", showOnDocuments: false, lineTotal: 999, createdAt: NOW, updatedAt: NOW });
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
