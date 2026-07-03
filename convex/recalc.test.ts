// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { recalcProjectTotals } from "./lib/recalc";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;

/**
 * Totals PARITY gate for the in-mutation recalc port (convex/lib/recalc.ts). Seeds a
 * project with a known mix of groups / lines / services / assignments / sub-hires and
 * asserts the recomputed totals equal the hand-computed values that
 * src/server/line-items.ts recalculateProjectTotals produces from the same inputs.
 */
describe("recalcProjectTotals — totals parity", () => {
  test("matches the hand-computed server-side totals", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "CONFIRMED", isTemplate: false, taxRate: 10, discountPercent: 0,
        createdAt: NOW, updatedAt: NOW,
      });
      // Group: price 100 × qty 2 = 200 (no custom extras).
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Lighting", price: 100, quantity: 2, sortOrder: 0 });
      // Standalone line: lineTotal 50 (counted).
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, lineTotal: 50 });
      // Optional line: excluded.
      await ctx.db.insert("projectLineItems", { id: "l2", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: true, lineTotal: 999 });
      // Grouped custom extra: +25 on top of the bundle.
      await ctx.db.insert("projectLineItems", { id: "l3", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, isCustomItem: true, groupId: "g1", lineTotal: 25 });
      // Service: billable revenue 30, cost 20.
      await ctx.db.insert("projectServices", { id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Design", status: "CONFIRMED", showOnDocuments: true, lineTotal: 30, costTotal: 20 });
      // Assignment: labour cost 40.
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", estimatedCost: 40 });
      // Sub-hire: cost 15.
      await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, projectId: "p1", supplierId: "sup1", createdById: "u1", orderNumber: "SH-1", status: "CONFIRMED", totalCost: 15 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    // equipmentRevenue = group 200 + custom extra 25 + standalone 50 = 275
    expect(p?.equipmentRevenue).toBe(275);
    // subtotal = equipment 275 + serviceRevenue 30 = 305
    expect(p?.subtotal).toBe(305);
    expect(p?.serviceCostTotal).toBe(20);
    expect(p?.labourCostTotal).toBe(40);
    expect(p?.subHireCostTotal).toBe(15);
    expect(p?.discountAmount).toBe(0);
    // tax 10% of 305 = 30.5
    expect(p?.taxAmount).toBe(30.5);
    expect(p?.total).toBe(335.5);
    // margin = total 335.5 - (svc 20 + labour 40 + subhire 15 = 75) = 260.5
    expect(p?.margin).toBe(260.5);
    expect(p?.updatedAt).toBe(NOW + 1);
  });

  test("uses org default tax when the project has no override", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, discountPercent: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, lineTotal: 100 });
      // project.taxRate is null → org default 20 passed in.
      await recalcProjectTotals(ctx, "p1", ORG, 20, NOW);
    });
    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.subtotal).toBe(100);
    expect(p?.taxAmount).toBe(20); // 20% of 100
    expect(p?.total).toBe(120);
  });
});
