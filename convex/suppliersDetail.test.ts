// @vitest-environment node
//
// suppliers.detail — browser-native replacement for getSupplierById. Verifies the
// mapped supplier shape + _count{assets, orders, lineItems} (each index-scoped to
// the supplier, org-filtered — parity with getOrgSupplierCounts), null/default
// coercion, cross-tenant isolation, and RBAC.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const makeT = () => convexTest(schema, modules);

const seed = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("suppliers", {
      id: "sup1",
      organizationId: ORG,
      name: "Acme Rentals",
      email: "hi@acme.test",
      tags: ["preferred"],
    });
    await ctx.db.insert("suppliers", { id: "supX", organizationId: OTHER, name: "Other Org Supplier" });

    // assets for sup1 (2 in-org) + 1 other-org (must NOT count)
    const asset = (id: string, org: string, supplierId: string | undefined) =>
      ctx.db.insert("assets", { id, organizationId: org, modelId: "mod", assetTag: "T" + id, ...(supplierId ? { supplierId } : {}) });
    await asset("a1", ORG, "sup1");
    await asset("a2", ORG, "sup1");
    await asset("a3", ORG, "sup2"); // different supplier
    await asset("ax", OTHER, "sup1"); // other-org, same supplierId

    // orders for sup1: 3 in-org + 1 other-org
    const order = (id: string, org: string, supplierId: string) =>
      ctx.db.insert("supplierOrders", { id, organizationId: org, supplierId, orderNumber: "PO-" + id, type: "PURCHASE" });
    await order("o1", ORG, "sup1");
    await order("o2", ORG, "sup1");
    await order("o3", ORG, "sup1");
    await order("ox", OTHER, "sup1");

    // line items referencing sup1: 1 in-org + 1 other-org
    const line = (id: string, org: string, supplierId: string) =>
      ctx.db.insert("projectLineItems", { id, organizationId: org, projectId: "p1", supplierId });
    await line("l1", ORG, "sup1");
    await line("lx", OTHER, "sup1");
  });

describe("suppliers.detail", () => {
  test("returns mapped supplier + org-scoped counts", async () => {
    const t = makeT();
    await seed(t);
    const s = await t.withIdentity(asUser).query(api.suppliers.detail, { orgId: ORG, id: "sup1" });
    expect(s.id).toBe("sup1");
    expect(s.name).toBe("Acme Rentals");
    expect(s.email).toBe("hi@acme.test");
    expect(s.contactName).toBeNull(); // default coercion
    expect(s.tags).toEqual(["preferred"]);
    expect(s.isActive).toBe(true); // default
    expect(typeof s.createdAt).toBe("string"); // ISO
    expect(s._count).toEqual({ assets: 2, orders: 3, lineItems: 1 }); // other-org excluded
  });

  test("throws for a supplier in another org (cross-tenant)", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser).query(api.suppliers.detail, { orgId: ORG, id: "supX" }),
    ).rejects.toThrow(/not found/i);
  });

  test("throws for a missing supplier", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser).query(api.suppliers.detail, { orgId: ORG, id: "ghost" }),
    ).rejects.toThrow(/not found/i);
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.suppliers.detail, { orgId: ORG, id: "sup1" }),
    ).rejects.toThrow();
  });
});
