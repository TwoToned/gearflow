// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { recalcOrderTotals } from "./lib/recalcOrderTotals";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;

/**
 * WS7 #946 — money gate for recalcOrderTotals (convex/lib/recalcOrderTotals.ts).
 * FEATUREDOCS/22 documented a `recalculateOrderTotals()` helper that never actually
 * existed; this is the real thing. Seeds an order + items and asserts subtotal/tax/
 * total, including the org default tax rate override and the 10% fallback.
 */

async function seedOrder(t: ReturnType<typeof convexTest>, fields: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("supplierOrders", {
      id: "o1", organizationId: ORG, supplierId: "sup1", orderNumber: "PO-1", type: "PURCHASE",
      ...fields,
    });
  });
}

describe("recalcOrderTotals", () => {
  test("sums item lineTotals into subtotal, applies the 10% fallback tax rate (no orgSettings row)", async () => {
    const t = convexTest(schema, modules);
    await seedOrder(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrderItems", { id: "i1", orderId: "o1", description: "A", lineTotal: 100 });
      await ctx.db.insert("supplierOrderItems", { id: "i2", orderId: "o1", description: "B", lineTotal: 50.5 });
      await recalcOrderTotals(ctx, "o1", ORG, NOW + 1);
    });
    const o = await t.run(async (ctx) => ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first());
    expect(o?.subtotal).toBe(150.5);
    expect(o?.taxAmount).toBe(15.05);
    expect(o?.total).toBe(165.55);
    expect(o?.updatedAt).toBe(NOW + 1);
  });

  test("uses the org's registered defaultTaxRate instead of the 10% fallback", async () => {
    const t = convexTest(schema, modules);
    await seedOrder(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgSettings", { organizationId: ORG, defaultTaxRate: 15 });
      await ctx.db.insert("supplierOrderItems", { id: "i1", orderId: "o1", description: "A", lineTotal: 200 });
      await recalcOrderTotals(ctx, "o1", ORG, NOW + 1);
    });
    const o = await t.run(async (ctx) => ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first());
    expect(o?.subtotal).toBe(200);
    expect(o?.taxAmount).toBe(30);
    expect(o?.total).toBe(230);
  });

  test("zero items -> zero totals (not left stale from a prior recalc)", async () => {
    const t = convexTest(schema, modules);
    await seedOrder(t, { subtotal: 999, taxAmount: 99, total: 1098 });
    await t.run(async (ctx) => {
      await recalcOrderTotals(ctx, "o1", ORG, NOW + 1);
    });
    const o = await t.run(async (ctx) => ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first());
    expect(o?.subtotal).toBe(0);
    expect(o?.taxAmount).toBe(0);
    expect(o?.total).toBe(0);
  });

  test("no-op for a missing / cross-org order (defence-in-depth)", async () => {
    const t = convexTest(schema, modules);
    await seedOrder(t, { organizationId: OTHER });
    await t.run(async (ctx) => {
      await recalcOrderTotals(ctx, "o1", ORG, NOW + 1); // caller org != row org
      await recalcOrderTotals(ctx, "ghost", ORG, NOW + 1); // missing id
    });
    const o = await t.run(async (ctx) => ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first());
    expect(o?.updatedAt).toBeUndefined(); // untouched
  });
});
