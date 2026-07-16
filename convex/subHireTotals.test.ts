// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { recalcSubHireTotals, upsertSupplierModelRate } from "./lib/subHireTotals";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;

/**
 * Money gate for recalcSubHireTotals (convex/lib/subHireTotals.ts) — byte-parity
 * with src/server/sub-hires.ts recalculateSubHireTotals. Seeds a sub-hire + groups
 * + items and asserts the recomputed totalCost / totalCharge equal the hand-computed
 * values in both pricing modes.
 */

async function seedSubHire(
  t: ReturnType<typeof convexTest>,
  fields: Record<string, unknown>,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("subHires", {
      id: "sh1", organizationId: ORG, supplierId: "sup1", createdById: "u1", orderNumber: "SH-0001",
      ...fields,
    });
  });
}

describe("recalcSubHireTotals — ORDER_TOTAL mode", () => {
  test("flat orderTotalCost + orderTotalCharge win", async () => {
    const t = convexTest(schema, modules);
    await seedSubHire(t, { pricingMode: "ORDER_TOTAL", orderTotalCost: 500, orderTotalCharge: 800 });
    await t.run(async (ctx) => {
      // Groups/items present but IGNORED for charge (flat orderTotalCharge set).
      await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "G", quantity: 2, charge: 100, sortOrder: 0 });
      await ctx.db.insert("subHireItems", { id: "i1", subHireId: "sh1", groupId: "g1", description: "X", quantity: 1, unitCharge: 999, duration: 1, sortOrder: 0 });
      await recalcSubHireTotals(ctx, "sh1", ORG, NOW + 1);
    });
    const sh = await t.run(async (ctx) => ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", "sh1")).first());
    expect(sh?.totalCost).toBe(500);
    expect(sh?.totalCharge).toBe(800);
    expect(sh?.updatedAt).toBe(NOW + 1);
  });

  test("summed: group charges (with discount) + ungrouped item charges", async () => {
    const t = convexTest(schema, modules);
    await seedSubHire(t, { pricingMode: "ORDER_TOTAL", orderTotalCost: 200 /* orderTotalCharge unset */ });
    await t.run(async (ctx) => {
      // Group g1: charge 100 × qty 2 × (1 - 10/100) = 180. Its item is charge-handled.
      await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "G", quantity: 2, charge: 100, discount: 10, sortOrder: 0 });
      await ctx.db.insert("subHireItems", { id: "i1", subHireId: "sh1", groupId: "g1", description: "In group", quantity: 5, unitCharge: 999, duration: 9, sortOrder: 0 });
      // Ungrouped item: 50 × qty 2 × dur 3 × (1 - 0) = 300.
      await ctx.db.insert("subHireItems", { id: "i2", subHireId: "sh1", description: "Loose", quantity: 2, unitCharge: 50, duration: 3, discount: 0, sortOrder: 1 });
      await recalcSubHireTotals(ctx, "sh1", ORG, NOW + 1);
    });
    const sh = await t.run(async (ctx) => ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", "sh1")).first());
    // totalCost = orderTotalCost = 200. totalCharge = 180 + 300 = 480.
    expect(sh?.totalCost).toBe(200);
    expect(sh?.totalCharge).toBe(480);
  });
});

describe("recalcSubHireTotals — ITEMIZED mode", () => {
  test("group cost/charge overrides skip their items; per-item cost/charge with discount", async () => {
    const t = convexTest(schema, modules);
    await seedSubHire(t, { pricingMode: "ITEMIZED" });
    await t.run(async (ctx) => {
      // Group g1: flat cost 300 × qty 2 = 600 (cost-handled); flat charge 400 × qty 1 × (1-0) = 400 (charge-handled).
      await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "G", quantity: 2, cost: 300, charge: 400, sortOrder: 0 });
      // Item in g1: both cost + charge SKIPPED (group has flat cost + flat charge).
      await ctx.db.insert("subHireItems", { id: "i1", subHireId: "sh1", groupId: "g1", description: "In group", quantity: 3, unitCost: 999, unitCharge: 999, duration: 3, sortOrder: 0 });
      // Ungrouped item: cost 10 × 2 × 3 = 60; charge 20 × 2 × 3 × (1-50/100) = 60.
      await ctx.db.insert("subHireItems", { id: "i2", subHireId: "sh1", description: "Loose", quantity: 2, unitCost: 10, unitCharge: 20, duration: 3, discount: 50, sortOrder: 1 });
      await recalcSubHireTotals(ctx, "sh1", ORG, NOW + 1);
    });
    const sh = await t.run(async (ctx) => ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", "sh1")).first());
    // totalCost = group 300×2=600 + item 60 = 660.
    // totalCharge = group 400×2×(1-0)=800 + item 60 = 860.
    expect(sh?.totalCost).toBe(660);
    expect(sh?.totalCharge).toBe(860);
  });

  test("no groups: pure per-item cost/charge with defaults (qty ?? 1, dur ?? 1)", async () => {
    const t = convexTest(schema, modules);
    await seedSubHire(t, { pricingMode: "ITEMIZED" });
    await t.run(async (ctx) => {
      // Omit quantity + duration → default to 1 each (mirrors mapSubHireItem).
      await ctx.db.insert("subHireItems", { id: "i1", subHireId: "sh1", description: "A", unitCost: 12.5, unitCharge: 33.33, sortOrder: 0 });
      await recalcSubHireTotals(ctx, "sh1", ORG, NOW + 1);
    });
    const sh = await t.run(async (ctx) => ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", "sh1")).first());
    expect(sh?.totalCost).toBe(12.5);
    expect(sh?.totalCharge).toBe(33.33);
  });

  test("no-op when the sub-hire is gone", async () => {
    const t = convexTest(schema, modules);
    // Resolves without throwing (t.run coerces the void return to null over the wire).
    await expect(
      t.run(async (ctx) => recalcSubHireTotals(ctx, "missing", ORG, NOW)),
    ).resolves.toBeNull();
  });
});

describe("upsertSupplierModelRate", () => {
  test("inserts a fresh rate, then patches it on the next call", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      upsertSupplierModelRate(ctx, { orgId: ORG, supplierId: "sup1", modelId: "m1", unitCost: 100, pricingType: "PER_DAY", now: NOW }),
    );
    let rows = await t.run(async (ctx) =>
      ctx.db.query("supplierModelRates").withIndex("by_organizationId_supplierId_modelId", (q) => q.eq("organizationId", ORG).eq("supplierId", "sup1").eq("modelId", "m1")).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastUnitCost).toBe(100);
    expect(rows[0].pricingType).toBe("PER_DAY");
    expect(rows[0].lastUsedAt).toBe(NOW);

    await t.run(async (ctx) =>
      upsertSupplierModelRate(ctx, { orgId: ORG, supplierId: "sup1", modelId: "m1", unitCost: 250, pricingType: "FLAT", now: NOW + 5 }),
    );
    rows = await t.run(async (ctx) =>
      ctx.db.query("supplierModelRates").withIndex("by_organizationId_supplierId_modelId", (q) => q.eq("organizationId", ORG).eq("supplierId", "sup1").eq("modelId", "m1")).collect(),
    );
    // Patched in place — still ONE row.
    expect(rows).toHaveLength(1);
    expect(rows[0].lastUnitCost).toBe(250);
    expect(rows[0].pricingType).toBe("FLAT");
    expect(rows[0].lastUsedAt).toBe(NOW + 5);
  });
});
