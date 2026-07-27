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

  // WS1 (#940) — depositPaid/invoicedTotal are DERIVED from this project's
  // Invoice rows, never hand-typed. See the schema.ts field comment + the
  // "6b." block in recalc.ts.
  describe("derived depositPaid / invoicedTotal (WS1 #940)", () => {
    async function seedProject(t: ReturnType<typeof convexTest>) {
      await t.run(async (ctx) => {
        await ctx.db.insert("projects", {
          id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
          status: "CONFIRMED", isTemplate: false, taxRate: 10, discountPercent: 0,
          createdAt: NOW, updatedAt: NOW,
        });
      });
    }

    test("both are 0 when the project has no invoices", async () => {
      const t = convexTest(schema, modules);
      await seedProject(t);
      await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1));
      const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
      expect(p?.depositPaid).toBe(0);
      expect(p?.invoicedTotal).toBe(0);
    });

    test("sums only ISSUED invoices — DRAFT and VOID are excluded", async () => {
      const t = convexTest(schema, modules);
      await seedProject(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("invoices", { id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "ISSUED", subtotal: 227.27, taxAmount: 22.73, total: 250, invoiceNumber: "INV-1" });
        await ctx.db.insert("invoices", { id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "BALANCE", status: "DRAFT", subtotal: 682, taxAmount: 68, total: 750 });
        await ctx.db.insert("invoices", { id: "i3", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", status: "VOID", subtotal: 909, taxAmount: 91, total: 1000 });
      });
      await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1));
      const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
      // Only i1 (ISSUED) counts.
      expect(p?.invoicedTotal).toBe(250);
      expect(p?.depositPaid).toBe(250); // i1 is also the DEPOSIT-kind subset
    });

    test("invoicedTotal sums DEPOSIT + BALANCE + FULL + CREDIT (an issued credit nets it down); depositPaid is the DEPOSIT-only subset", async () => {
      const t = convexTest(schema, modules);
      await seedProject(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("invoices", { id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "ISSUED", subtotal: 227.27, taxAmount: 22.73, total: 250, invoiceNumber: "INV-1" });
        await ctx.db.insert("invoices", { id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "BALANCE", status: "ISSUED", subtotal: 682, taxAmount: 68, total: 750, invoiceNumber: "INV-2" });
        await ctx.db.insert("invoices", { id: "i3", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "CREDIT", status: "ISSUED", subtotal: -45.45, taxAmount: -4.55, total: -50, invoiceNumber: "INV-3", creditForInvoiceId: "i2" });
      });
      await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1));
      const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
      expect(p?.invoicedTotal).toBe(950); // 250 + 750 - 50
      expect(p?.depositPaid).toBe(250); // only the DEPOSIT-kind invoice
    });

    test("a second org's invoices on a same-numbered project never leak in (org-scoped by_organizationId_projectId)", async () => {
      const t = convexTest(schema, modules);
      const OTHER = "org_2";
      await seedProject(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("projects", { id: "p1", organizationId: OTHER, projectNumber: "P1", name: "Other org's gig", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
        await ctx.db.insert("invoices", { id: "i-other", organizationId: OTHER, projectId: "p1", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 900, taxAmount: 100, total: 1000, invoiceNumber: "INV-OTHER-1" });
      });
      await t.run(async (ctx) => recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1));
      // ORG's p1 must not pick up OTHER org's identically-numbered ("p1") project's invoice.
      const orgP1 = await t.run(async (ctx) =>
        (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).collect()).find((row) => row.organizationId === ORG),
      );
      expect(orgP1?.invoicedTotal).toBe(0);
      expect(orgP1?.depositPaid).toBe(0);
    });
  });
});

describe("recalcProjectTotals — WS11 (#950) sale revenue + COGS", () => {
  async function seedProject(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "CONFIRMED", isTemplate: false, taxRate: 10, discountPercent: 0,
        createdAt: NOW, updatedAt: NOW,
      });
    });
  }

  test("standalone SALE lines bill into saleRevenue, excluded from equipmentRevenue", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, lineTotal: 100 });
      await ctx.db.insert("projectLineItems", { id: "sale1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "SALE", saleMode: "NEW_STOCK", isKitChild: false, isOptional: false, lineTotal: 300 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });
    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.equipmentRevenue).toBe(100); // sale excluded
    expect(p?.saleRevenue).toBe(300);
    // subtotal = equipment 100 + service 0 + sale 300 = 400
    expect(p?.subtotal).toBe(400);
  });

  test("saleCostTotal resolves the unit-cost chain (asset -> model -> bulkAsset -> replacementCost) and reduces margin", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", defaultPurchasePrice: 50, replacementCost: 200 });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", purchasePrice: 80, status: "SOLD", isActive: false });
      // Line 1: assetId set -> uses asset.purchasePrice (80), not model.defaultPurchasePrice.
      await ctx.db.insert("projectLineItems", { id: "sale1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "SALE", saleMode: "FROM_RENTAL_STOCK", assetId: "a1", modelId: "m1", quantity: 1, isKitChild: false, isOptional: false, lineTotal: 300 });
      // Line 2: no assetId, modelId only -> falls to model.defaultPurchasePrice (50), qty 2.
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Cable", defaultPurchasePrice: 5 });
      await ctx.db.insert("projectLineItems", { id: "sale2", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "SALE", saleMode: "NEW_STOCK", modelId: "m2", quantity: 2, isKitChild: false, isOptional: false, lineTotal: 40 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });
    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    // saleCostTotal = (80 * 1) + (5 * 2) = 90
    expect(p?.saleCostTotal).toBe(90);
    // saleRevenue = 300 + 40 = 340; subtotal = 340; tax 10% = 34; total = 374
    expect(p?.saleRevenue).toBe(340);
    expect(p?.total).toBe(374);
    // margin = total 374 - saleCostTotal 90 (no other costs) = 284
    expect(p?.margin).toBe(284);
  });

  test("cancelled/optional SALE lines are excluded from both saleRevenue and saleCostTotal", async () => {
    const t = convexTest(schema, modules);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "SM58", defaultPurchasePrice: 50 });
      await ctx.db.insert("projectLineItems", { id: "cancelled1", organizationId: ORG, projectId: "p1", status: "CANCELLED", type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 1, isKitChild: false, isOptional: false, lineTotal: 999 });
      await ctx.db.insert("projectLineItems", { id: "optional1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "SALE", saleMode: "NEW_STOCK", modelId: "m1", quantity: 1, isKitChild: false, isOptional: true, lineTotal: 999 });
      await recalcProjectTotals(ctx, "p1", ORG, null, NOW + 1);
    });
    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.saleRevenue).toBe(0);
    expect(p?.saleCostTotal).toBe(0);
  });
});
