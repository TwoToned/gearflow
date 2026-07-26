// @vitest-environment node
//
// WS7 #946 — supplier spend rollups. `computeSupplierSpend` is a pure function
// (no ctx), unit-tested directly here without a Convex harness for the de-dup
// fixture (linked + unlinked mix); `suppliers.detail`'s `spend` field and the new
// sub-hire-heads shape of `suppliers.subhiresPage` are covered via convexTest
// integration checks below.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { computeSupplierSpend } from "./suppliers";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

// ─── computeSupplierSpend — pure de-dup fixture (linked + unlinked mix) ───────
describe("computeSupplierSpend", () => {
  test("unlinked orders + unlinked sub-hires sum independently (no dedup needed)", () => {
    const result = computeSupplierSpend(
      [{ id: "o1", status: "ORDERED", total: 500 }],
      [{ id: "sh1", status: "CONFIRMED", totalCost: 300, supplierOrderId: undefined }],
    );
    expect(result.committedOrderSpend).toBe(500);
    expect(result.subHireSpend).toBe(300);
    expect(result.totalSpend).toBe(800); // no overlap — simple sum
  });

  test("a linked pair (order RECEIVED) counts ONCE at the order's total, not both", () => {
    const result = computeSupplierSpend(
      [{ id: "o1", status: "RECEIVED", total: 550 }],
      [{ id: "sh1", status: "CONFIRMED", totalCost: 500, supplierOrderId: "o1" }],
    );
    expect(result.committedOrderSpend).toBe(550); // gross figures unaffected
    expect(result.subHireSpend).toBe(500);
    expect(result.totalSpend).toBe(550); // deduplicated: invoiced amount, once
  });

  test("a linked pair NOT YET received counts once at the sub-hire's quoted totalCost", () => {
    const result = computeSupplierSpend(
      [{ id: "o1", status: "ORDERED", total: 999 /* not yet the real invoice */ }],
      [{ id: "sh1", status: "CONFIRMED", totalCost: 500, supplierOrderId: "o1" }],
    );
    expect(result.totalSpend).toBe(500); // quoted, not the ORDERED-stage total
  });

  test("mixed: one linked (RECEIVED) pair + one unlinked order + one unlinked sub-hire", () => {
    const result = computeSupplierSpend(
      [
        { id: "o1", status: "RECEIVED", total: 550 }, // linked
        { id: "o2", status: "PARTIAL", total: 200 }, // unlinked, committed
      ],
      [
        { id: "sh1", status: "CONFIRMED", totalCost: 500, supplierOrderId: "o1" }, // linked
        { id: "sh2", status: "ON_HIRE", totalCost: 75, supplierOrderId: undefined }, // unlinked
      ],
    );
    expect(result.totalSpend).toBe(550 + 200 + 75); // 825, each transaction counted once
    expect(result.committedOrderSpend).toBe(750); // 550 + 200, gross
    expect(result.subHireSpend).toBe(575); // 500 + 75, gross
  });

  test("DRAFT/CANCELLED orders and sub-hires are excluded from committed/active spend", () => {
    const result = computeSupplierSpend(
      [
        { id: "o1", status: "DRAFT", total: 999 },
        { id: "o2", status: "CANCELLED", total: 999 },
      ],
      [
        { id: "sh1", status: "DRAFT", totalCost: 999, supplierOrderId: undefined },
        { id: "sh2", status: "CANCELLED", totalCost: 999, supplierOrderId: undefined },
      ],
    );
    expect(result.committedOrderSpend).toBe(0);
    expect(result.subHireSpend).toBe(0);
    expect(result.totalSpend).toBe(0);
  });

  test("openOrderCount counts DRAFT/ORDERED/PARTIAL only", () => {
    const result = computeSupplierSpend(
      [
        { id: "o1", status: "DRAFT", total: undefined },
        { id: "o2", status: "ORDERED", total: undefined },
        { id: "o3", status: "PARTIAL", total: undefined },
        { id: "o4", status: "RECEIVED", total: undefined },
        { id: "o5", status: "CANCELLED", total: undefined },
      ],
      [],
    );
    expect(result.openOrderCount).toBe(3);
  });

  test("variance sums (order.total - subHire.totalCost) across every linked pair with a total, regardless of order status", () => {
    const result = computeSupplierSpend(
      [
        { id: "o1", status: "RECEIVED", total: 550 }, // variance +50
        { id: "o2", status: "ORDERED", total: 100 }, // variance -20 (still counted — "regardless of status")
        { id: "o3", status: "RECEIVED", total: undefined }, // no total yet — excluded from the sum, but still linked
      ],
      [
        { id: "sh1", status: "CONFIRMED", totalCost: 500, supplierOrderId: "o1" },
        { id: "sh2", status: "CONFIRMED", totalCost: 120, supplierOrderId: "o2" },
        { id: "sh3", status: "CONFIRMED", totalCost: 40, supplierOrderId: "o3" },
      ],
    );
    expect(result.variance.linkedCount).toBe(3);
    expect(result.variance.total).toBe(50 + (100 - 120)); // 30
  });

  test("a linked sub-hire whose order no longer exists (deleted) is excluded from variance, not crashed", () => {
    const result = computeSupplierSpend(
      [],
      [{ id: "sh1", status: "CONFIRMED", totalCost: 500, supplierOrderId: "ghost-order" }],
    );
    expect(result.variance.linkedCount).toBe(0);
    expect(result.totalSpend).toBe(500); // falls back to counting the sub-hire's own cost
  });
});

// ─── Integration: suppliers.detail's spend field + subhiresPage's new shape ──
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("suppliers", { id: "sup1", organizationId: ORG, name: "Acme Hire" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
  });
}

describe("suppliers.detail — spend rollup (integration)", () => {
  test("returns the de-duplicated spend alongside _count", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "sup1", orderNumber: "PO-1", type: "SUBHIRE", status: "RECEIVED", total: 550, createdAt: NOW });
      await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, supplierId: "sup1", createdById: USER, orderNumber: "SH-1", status: "CONFIRMED", totalCost: 500, totalCharge: 700, showOnDocs: false, supplierOrderId: "o1", createdAt: NOW });
    });
    const s = await t.withIdentity(asUser).query(api.suppliers.detail, { orgId: ORG, id: "sup1" });
    expect(s.spend.totalSpend).toBe(550); // linked + RECEIVED → invoiced amount once
    expect(s.spend.variance).toEqual({ total: 50, linkedCount: 1 });
    expect(s._count.orders).toBe(1);
  });
});

describe("suppliers.subhiresPage — sub-hire HEADS (visible behaviour change)", () => {
  test("returns order#/status/cost/charge/margin/linked-PO instead of raw line items", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "sup1", orderNumber: "PO-1", type: "SUBHIRE", createdAt: NOW });
      await ctx.db.insert("subHires", {
        id: "sh1", organizationId: ORG, supplierId: "sup1", projectId: "p1", createdById: USER,
        orderNumber: "SH-1", status: "CONFIRMED", totalCost: 500, totalCharge: 700, showOnDocs: false,
        supplierOrderId: "o1", createdAt: NOW,
      });
    });
    const res = await t.withIdentity(asUser).query(api.suppliers.subhiresPage, { orgId: ORG, supplierId: "sup1", page: 1, pageSize: 25 });
    expect(res.total).toBe(1);
    expect(res.subHires[0]).toMatchObject({
      id: "sh1", orderNumber: "SH-1", status: "CONFIRMED", totalCost: 500, totalCharge: 700, margin: 200,
      project: { id: "p1", name: "Gig" },
      linkedOrder: { id: "o1", orderNumber: "PO-1", status: "DRAFT" },
    });
  });
});
