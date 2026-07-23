// @vitest-environment node
//
// convex/supplierOrdersWrites.ts createNative + convex/supplierOrders.ts listBySupplier.
// Verifies: supplier/project org re-check, createdById from the verified actor, audit,
// RBAC (supplier:create), cross-tenant, and the supplier-scoped list (newest-first, item
// count, org-checked project join).
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

async function seed(t: T, opts: { supplierOrg?: string } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("suppliers", { id: "s1", organizationId: opts.supplierOrg ?? ORG, name: "Acme" });
    await ctx.db.insert("projects", { id: "P1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
  });
}

const create = (t: T, over: Record<string, unknown> = {}) =>
  t.withIdentity(asUser).mutation(api.supplierOrdersWrites.createNative, {
    id: "o1", orgId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", now: NOW, actor, auditId: "a1", ...over,
  });

describe("supplierOrdersWrites.createNative", () => {
  test("creates the order (createdById = verified actor) + audits", async () => {
    const t = makeT(); await seed(t);
    const res = await create(t, { projectId: "P1", status: "ORDERED" });
    expect(res).toEqual({ id: "o1" });
    const o = await t.run(async (ctx) => ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", "o1")).first());
    expect(o?.createdById).toBe(USER);
    expect(o?.status).toBe("ORDERED");
    const audit = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(audit?.summary).toBe("Created order PO-1");
  });

  test("rejects a duplicate (foreign) order id to prevent a cross-tenant count leak", async () => {
    const t = makeT(); await seed(t);
    // A victim order in ANOTHER org already holds id "o1".
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", { id: "o1", organizationId: OTHER, supplierId: "sV", orderNumber: "VIC", type: "PURCHASE", createdAt: NOW });
    });
    await expect(create(t)).rejects.toThrow(/already exists/i);
  });

  test("rejects a supplier in another org", async () => {
    const t = makeT(); await seed(t, { supplierOrg: OTHER });
    await expect(create(t)).rejects.toThrow(/Supplier not found/i);
  });

  test("rejects a project in another org", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "Pother", organizationId: OTHER, projectNumber: "PX", name: "X", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    await expect(create(t, { projectId: "Pother" })).rejects.toThrow(/Project not found/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing supplierOrderSchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  test("rejects an orderNumber over the 100-char bound", async () => {
    const t = makeT(); await seed(t);
    await expect(create(t, { orderNumber: "X".repeat(101) })).rejects.toThrow(/orderNumber/);
  });

  test("rejects an empty orderNumber", async () => {
    const t = makeT(); await seed(t);
    await expect(create(t, { orderNumber: "" })).rejects.toThrow(/orderNumber/);
  });

  test("rejects notes over the 2000-char bound", async () => {
    const t = makeT(); await seed(t);
    await expect(create(t, { notes: "X".repeat(2001) })).rejects.toThrow(/notes/);
  });

  test("RBAC: a viewer (no supplier:create) is rejected", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.supplierOrdersWrites.createNative, {
        id: "o1", orgId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("supplierOrders.listBySupplier", () => {
  test("returns the supplier's orders newest-first with item count + org-checked project", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", status: "DRAFT", projectId: "P1", createdAt: NOW });
      await ctx.db.insert("supplierOrders", { id: "o2", organizationId: ORG, supplierId: "s1", orderNumber: "PO-2", type: "PURCHASE", createdAt: NOW + 10 });
      await ctx.db.insert("supplierOrders", { id: "oX", organizationId: ORG, supplierId: "sOther", orderNumber: "PO-X", type: "PURCHASE", createdAt: NOW });
      await ctx.db.insert("supplierOrderItems", { id: "i1", orderId: "o1", description: "widget", quantity: 1, sortOrder: 0 });
      await ctx.db.insert("supplierOrderItems", { id: "i2", orderId: "o1", description: "gadget", quantity: 1, sortOrder: 1 });
    });
    const res = await t.withIdentity(asUser).query(api.supplierOrders.listBySupplier, { orgId: ORG, supplierId: "s1" });
    expect(res.orders.map((o) => o.id)).toEqual(["o2", "o1"]); // newest first, other-supplier excluded
    const o1 = res.orders.find((o) => o.id === "o1");
    expect(o1?._count.items).toBe(2);
    expect(o1?.project).toEqual({ id: "P1", name: "Gig", projectNumber: "P1" });
    expect(res.orders.find((o) => o.id === "o2")?.status).toBe("DRAFT"); // default when absent
  });

  test("cross-tenant: another org's caller sees no orders (org guard)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "PO-1", type: "PURCHASE", createdAt: NOW });
    });
    await expect(
      t.withIdentity({ subject: "intruder", orgId: OTHER }).query(api.supplierOrders.listBySupplier, { orgId: ORG, supplierId: "s1" }),
    ).rejects.toThrow(/Forbidden|organization/i);
  });
});
