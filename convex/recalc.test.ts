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
      // Grouped custom item: PART of the group's flat price, NOT an extra on top.
      // The group is priced (100), so this 25 is covered by the bundle, not added.
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
    // equipmentRevenue = group 200 (custom is INSIDE the flat price) + standalone 50 = 250
    expect(p?.equipmentRevenue).toBe(250);
    // subtotal = equipment 250 + serviceRevenue 30 = 280
    expect(p?.subtotal).toBe(280);
    expect(p?.serviceCostTotal).toBe(20);
    expect(p?.labourCostTotal).toBe(40);
    expect(p?.subHireCostTotal).toBe(15);
    expect(p?.discountAmount).toBe(0);
    // tax 10% of 280 = 28
    expect(p?.taxAmount).toBe(28);
    expect(p?.total).toBe(308);
    // margin = total 308 - (svc 20 + labour 40 + subhire 15 = 75) = 233
    expect(p?.margin).toBe(233);
    expect(p?.updatedAt).toBe(NOW + 1);
  });

  test("counts a sub-hire line placed inside a priced project group (issue #8)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "CONFIRMED", isTemplate: false, taxRate: 10, discountPercent: 0,
        createdAt: NOW, updatedAt: NOW,
      });
      // Priced group: 100 × qty 1 = 100. Its flat price covers its OWN gear only.
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Audio", price: 100, quantity: 1, sortOrder: 0 });
      // Sub-hire line dropped INTO the priced group. Before the fix this vanished
      // (groupRevenue's customExtras is zeroed for a priced group, and standalone
      // requires groupId == null). It carries its own client charge (60).
      await ctx.db.insert("projectLineItems", { id: "sl1", organizationId: ORG, projectId: "p1", status: "QUOTED", type: "EQUIPMENT", isKitChild: false, isOptional: false, groupId: "g1", subHireId: "sh1", subHireItemId: "si1", lineTotal: 60 });
      // A kit-style child of a sub-hire group in the same group — excluded (would
      // double-count against its parent's group charge).
      await ctx.db.insert("projectLineItems", { id: "sl2", organizationId: ORG, projectId: "p1", status: "QUOTED", type: "EQUIPMENT", isKitChild: true, isOptional: false, groupId: "g1", subHireId: "sh1", subHireItemId: "si2", lineTotal: 40 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    // group 100 + standalone 0 + grouped sub-hire 60 (child 40 excluded) = 160
    expect(p?.equipmentRevenue).toBe(160);
  });

  test("subtracts a Project Group's flat discount from its bundle revenue (#883)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "CONFIRMED", isTemplate: false, taxRate: 0, discountPercent: 0,
        createdAt: NOW, updatedAt: NOW,
      });
      // price 100 × qty 2 = 200, minus a flat $50 group discount = 150.
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Lighting", price: 100, quantity: 2, discount: 50, sortOrder: 0 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.equipmentRevenue).toBe(150);
    expect(p?.subtotal).toBe(150);
  });

  test("clamps a Project Group's discount at 0 rather than going negative (#883)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "CONFIRMED", isTemplate: false, taxRate: 0, discountPercent: 0,
        createdAt: NOW, updatedAt: NOW,
      });
      // price 100 × qty 1 = 100, discount 9999 — must clamp at 0, not go negative.
      await ctx.db.insert("projectGroups", { id: "g1", organizationId: ORG, projectId: "p1", title: "Lighting", price: 100, quantity: 1, discount: 9999, sortOrder: 0 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.equipmentRevenue).toBe(0);
  });

  test("excludes service-linked crew cost from labourCostTotal (no double-count with serviceCostTotal, #796)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "CONFIRMED", isTemplate: false, taxRate: 0, discountPercent: 0,
        createdAt: NOW, updatedAt: NOW,
      });
      // Service's costTotal is already the rolled-up sum of its own crew (as
      // recalcServiceCostFromCrew would have set it) — 100.
      await ctx.db.insert("projectServices", { id: "s1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Bump in", status: "CONFIRMED", showOnDocuments: false, costTotal: 100 });
      // This assignment IS that service's crew — must NOT also land in labourCostTotal.
      await ctx.db.insert("crewAssignments", { id: "a1", organizationId: ORG, projectId: "p1", crewMemberId: "c1", serviceId: "s1", estimatedCost: 100 });
      // A standalone (no serviceId) assignment DOES still count in labourCostTotal.
      await ctx.db.insert("crewAssignments", { id: "a2", organizationId: ORG, projectId: "p1", crewMemberId: "c2", estimatedCost: 40 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });

    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.serviceCostTotal).toBe(100);
    expect(p?.labourCostTotal).toBe(40);
    // margin = total(0) - (100 + 40 + 0) = -140
    expect(p?.margin).toBe(-140);
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
