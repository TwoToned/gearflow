// @vitest-environment node
//
// convex/supplierOrderItemsWrites.ts — the FIRST browser path for supplierOrderItems
// (WS7 #946; there was previously none). Verifies: lineTotal always computed
// server-side, recalcOrderTotals runs after every add/update/remove, model/asset FK
// org-checks, cross-tenant isolation, and RBAC (supplier:update).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "manager" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "Acme" });
    await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", createdAt: NOW });
  });
}

const orderRow = (t: T) => t.run(async (ctx) => ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first());
const itemRow = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const addItem = (t: T, over: Record<string, unknown> = {}) =>
  t.withIdentity(asUser).mutation(api.supplierOrderItemsWrites.addSupplierOrderItemNative, {
    id: "i1", orgId: ORG, orderId: "o1", description: "Widget", quantity: 2, unitPrice: 10, now: NOW, actor, auditId: "a1", ...over,
  });

describe("supplierOrderItemsWrites.addSupplierOrderItemNative", () => {
  test("inserts the item, computes lineTotal server-side, recalcs order totals, audits", async () => {
    const t = makeT(); await seed(t);
    const res = await addItem(t);
    expect(res).toEqual({ id: "i1" });
    const item = await itemRow(t, "i1");
    expect(item?.lineTotal).toBe(20); // 2 x 10, never client-trusted
    expect(item?.sortOrder).toBe(0);
    const order = await orderRow(t);
    expect(order?.subtotal).toBe(20);
    expect(order?.total).toBe(22); // 10% fallback tax
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.summary).toBe('Added item "Widget" to order PO-1');
  });

  test("second item gets the next sortOrder and its lineTotal adds into the running subtotal", async () => {
    const t = makeT(); await seed(t);
    await addItem(t);
    await addItem(t, { id: "i2", description: "Gadget", quantity: 1, unitPrice: 5, auditId: "a2" });
    const item2 = await itemRow(t, "i2");
    expect(item2?.sortOrder).toBe(1);
    const order = await orderRow(t);
    expect(order?.subtotal).toBe(25); // 20 + 5
  });

  test("rejects a modelId in another org", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mo1", organizationId: OTHER, name: "X" }); });
    await expect(addItem(t, { modelId: "mo1" })).rejects.toThrow(/not found/i);
  });

  test("rejects an assetId in another org", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: OTHER, modelId: "m", assetTag: "T" }); });
    await expect(addItem(t, { assetId: "as1" })).rejects.toThrow(/not found/i);
  });

  test("rejects an order in another org", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("supplierOrders", { id: "oX", organizationId: OTHER, supplierId: "sX", orderNumber: "PO-X", type: "PURCHASE", createdAt: NOW }); });
    await expect(addItem(t, { orderId: "oX" })).rejects.toThrow(/Order not found/i);
  });

  test("rejects an empty description / negative quantity/unitPrice", async () => {
    const t = makeT(); await seed(t);
    await expect(addItem(t, { description: "" })).rejects.toThrow(/Description/i);
    await expect(addItem(t, { quantity: 0 })).rejects.toThrow(/Quantity/i);
    await expect(addItem(t, { unitPrice: -1 })).rejects.toThrow(/Unit price/i);
  });

  test("RBAC: a viewer (no supplier:update) is rejected", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.supplierOrderItemsWrites.addSupplierOrderItemNative, {
        id: "i1", orgId: ORG, orderId: "o1", description: "Widget", quantity: 1, unitPrice: 1, now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("supplierOrderItemsWrites.updateSupplierOrderItemNative", () => {
  test("recomputes lineTotal + recalcs order totals", async () => {
    const t = makeT(); await seed(t);
    await addItem(t);
    await t.withIdentity(asUser).mutation(api.supplierOrderItemsWrites.updateSupplierOrderItemNative, {
      itemId: "i1", orgId: ORG, description: "Widget v2", quantity: 3, unitPrice: 10, now: NOW, actor, auditId: "a2",
    });
    const item = await itemRow(t, "i1");
    expect(item?.description).toBe("Widget v2");
    expect(item?.lineTotal).toBe(30);
    const order = await orderRow(t);
    expect(order?.subtotal).toBe(30);
  });

  test("clears modelId/assetId/notes when omitted", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mo1", organizationId: ORG, name: "X" }); });
    await addItem(t, { modelId: "mo1", notes: "keep me?" });
    await t.withIdentity(asUser).mutation(api.supplierOrderItemsWrites.updateSupplierOrderItemNative, {
      itemId: "i1", orgId: ORG, description: "Widget", quantity: 2, unitPrice: 10, now: NOW, actor, auditId: "a2",
    });
    const item = await itemRow(t, "i1");
    expect(item?.modelId).toBeUndefined();
    expect(item?.notes).toBeUndefined();
  });

  test("rejects an item in another org (via its parent order)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", { id: "oX", organizationId: OTHER, supplierId: "sX", orderNumber: "PO-X", type: "PURCHASE", createdAt: NOW });
      await ctx.db.insert("supplierOrderItems", { id: "iX", orderId: "oX", description: "Foreign", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.supplierOrderItemsWrites.updateSupplierOrderItemNative, {
        itemId: "iX", orgId: ORG, description: "Hijacked", quantity: 1, unitPrice: 1, now: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow(/Order not found/i);
  });
});

describe("supplierOrderItemsWrites.removeSupplierOrderItemNative", () => {
  test("deletes the item and recalcs order totals down to what's left", async () => {
    const t = makeT(); await seed(t);
    await addItem(t);
    await addItem(t, { id: "i2", description: "Gadget", quantity: 1, unitPrice: 5, auditId: "a2" });
    await t.withIdentity(asUser).mutation(api.supplierOrderItemsWrites.removeSupplierOrderItemNative, {
      itemId: "i1", orgId: ORG, now: NOW, actor, auditId: "a3",
    });
    expect(await itemRow(t, "i1")).toBeNull();
    const order = await orderRow(t);
    expect(order?.subtotal).toBe(5); // only "Gadget" left
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a3")).first());
    expect(log?.summary).toBe("Removed item from order PO-1");
  });
});

describe("supplierOrderItemsWrites.reorderSupplierOrderItemsNative", () => {
  test("sets sortOrder = index per id; no recalc, no audit", async () => {
    const t = makeT(); await seed(t);
    await addItem(t);
    await addItem(t, { id: "i2", description: "Gadget", quantity: 1, unitPrice: 5, auditId: "a2" });
    await t.withIdentity(asUser).mutation(api.supplierOrderItemsWrites.reorderSupplierOrderItemsNative, {
      orgId: ORG, orderId: "o1", itemIds: ["i2", "i1"], now: NOW, actor,
    });
    expect((await itemRow(t, "i2"))?.sortOrder).toBe(0);
    expect((await itemRow(t, "i1"))?.sortOrder).toBe(1);
  });

  test("empty itemIds is a no-op", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).mutation(api.supplierOrderItemsWrites.reorderSupplierOrderItemsNative, {
      orgId: ORG, orderId: "o1", itemIds: [], now: NOW, actor,
    });
    expect(res).toEqual({ ok: true });
  });
});
