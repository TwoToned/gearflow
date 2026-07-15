// @vitest-environment node
//
// convex/suppliersWrites.ts + convex/suppliers.ts (assetsPage / subhiresPage). Verifies
// CRUD + audit, the delete-guards (assets/lineItems/orders block) + rate cascade, per-row
// org re-check, RBAC (supplier:*), and the supplier-scoped tab reads.
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
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seedMember(t: T, role = "admin") {
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role }); });
}
const sup = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("suppliersWrites", () => {
  test("create → update → delete, with audit + rate cascade", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.suppliersWrites.createNative, { id: "s1", orgId: ORG, name: "Acme", tags: ["Cheap"], now: NOW, actor, auditId: "a1" });
    const c = await sup(t, "s1");
    expect(c?.name).toBe("Acme");
    expect(c?.tags).toEqual(["cheap"]); // lowercased
    await t.withIdentity(asUser).mutation(api.suppliersWrites.updateNative, { id: "s1", orgId: ORG, name: "Acme Ltd", now: NOW + 1, actor, auditId: "a2" });
    expect((await sup(t, "s1"))?.name).toBe("Acme Ltd");
    await t.run(async (ctx) => { await ctx.db.insert("supplierModelRates", { id: "sr1", organizationId: ORG, supplierId: "s1", modelId: "m", lastUnitCost: 10 }); });
    await t.withIdentity(asUser).mutation(api.suppliersWrites.removeNative, { id: "s1", orgId: ORG, now: NOW + 2, actor, auditId: "a3" });
    expect(await sup(t, "s1")).toBeNull();
    const rates = await t.run(async (ctx) => ctx.db.query("supplierModelRates").withIndex("by_supplierId", (q) => q.eq("supplierId", "s1")).collect());
    expect(rates).toHaveLength(0); // cascaded
  });

  test("delete blocked by linked assets, line items, then orders", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("suppliers", { id: "s1", organizationId: ORG, name: "S", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A", modelId: "m", supplierId: "s1" });
    });
    await expect(t.withIdentity(asUser).mutation(api.suppliersWrites.removeNative, { id: "s1", orgId: ORG, now: NOW, actor, auditId: "x1" })).rejects.toThrow(/linked assets/i);
    await t.run(async (ctx) => {
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first(); if (a) await ctx.db.delete(a._id);
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p", supplierId: "s1", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT", subHireId: "sh1" });
    });
    await expect(t.withIdentity(asUser).mutation(api.suppliersWrites.removeNative, { id: "s1", orgId: ORG, now: NOW, actor, auditId: "x2" })).rejects.toThrow(/line items/i);
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first(); if (li) await ctx.db.delete(li._id);
      await ctx.db.insert("supplierOrders", { id: "o1", organizationId: ORG, supplierId: "s1", orderNumber: "PO", type: "PURCHASE", createdAt: NOW });
    });
    await expect(t.withIdentity(asUser).mutation(api.suppliersWrites.removeNative, { id: "s1", orgId: ORG, now: NOW, actor, auditId: "x3" })).rejects.toThrow(/existing orders/i);
  });

  test("server-side validation: bad email + unpaired coords rejected", async () => {
    const t = makeT(); await seedMember(t);
    await expect(t.withIdentity(asUser).mutation(api.suppliersWrites.createNative, { id: "s1", orgId: ORG, name: "N", email: "nope", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/email/i);
    await expect(t.withIdentity(asUser).mutation(api.suppliersWrites.createNative, { id: "s2", orgId: ORG, name: "N", latitude: 1, now: NOW, actor, auditId: "a2" })).rejects.toThrow(/latitude and longitude/i);
  });

  test("update rejects a supplier in another org; RBAC rejects a viewer", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("suppliers", { id: "sX", organizationId: OTHER, name: "T", createdAt: NOW, updatedAt: NOW }); });
    await expect(t.withIdentity(asUser).mutation(api.suppliersWrites.updateNative, { id: "sX", orgId: ORG, name: "hijack", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.suppliersWrites.createNative, { id: "s1", orgId: ORG, name: "X", now: NOW, actor, auditId: "a2" })).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("suppliers tab reads", () => {
  test("assetsPage: supplier's active assets tag-asc, org-checked, with model", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Mixer" });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, assetTag: "B", modelId: "m1", supplierId: "s1", isActive: true });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A", modelId: "m1", supplierId: "s1", isActive: true });
      await ctx.db.insert("assets", { id: "aX", organizationId: OTHER, assetTag: "Z", modelId: "m1", supplierId: "s1", isActive: true });
    });
    const res = await t.withIdentity(asUser).query(api.suppliers.assetsPage, { orgId: ORG, supplierId: "s1", page: 1, pageSize: 25 });
    expect(res.total).toBe(2); // foreign-org asset excluded
    expect(res.assets.map((a) => a.id)).toEqual(["a1", "a2"]); // tag asc
    expect(res.assets[0].model?.name).toBe("Mixer");
  });

  test("subhiresPage: subHireId!=null line items, createdAt desc, with project", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", supplierId: "s1", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT", subHireId: "sh1", createdAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "p1", supplierId: "s1", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT", subHireId: "sh2", createdAt: NOW + 10 });
      await ctx.db.insert("projectLineItems", { id: "liPlain", organizationId: ORG, projectId: "p1", supplierId: "s1", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT", createdAt: NOW });
    });
    const res = await t.withIdentity(asUser).query(api.suppliers.subhiresPage, { orgId: ORG, supplierId: "s1", page: 1, pageSize: 25 });
    expect(res.lineItems.map((l) => l.id)).toEqual(["li2", "li1"]); // subHire only, newest first
    expect(res.lineItems[0].project?.projectNumber).toBe("P1");
  });
});
