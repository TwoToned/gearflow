// @vitest-environment node
//
// suppliers.counts — browser-native replacement for getSupplierCounts. Verifies:
// tallies assets + supplier orders per supplierId (parity with
// countSupplierAssetsAndOrders — every row with a supplierId, no isActive filter),
// org isolation (another org's assets/orders don't leak), and RBAC.
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
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    const asset = (id: string, org: string, supplierId?: string, isActive = true) =>
      ctx.db.insert("assets", { id, organizationId: org, modelId: "m1", assetTag: id, status: "AVAILABLE", isActive, supplierId });
    // s1: 2 assets (one inactive — still counted, no isActive filter); s2: 1 asset; no supplier: ignored.
    await asset("a1", ORG, "s1");
    await asset("a2", ORG, "s1", false);
    await asset("a3", ORG, "s2");
    await asset("a4", ORG, undefined);
    await asset("ax", OTHER, "s1"); // other org → must not leak
    const order = (id: string, org: string, supplierId: string) =>
      ctx.db.insert("supplierOrders", { id, organizationId: org, supplierId, orderNumber: id, type: "PURCHASE" });
    await order("o1", ORG, "s1"); // s1: 1 order
    await order("o2", ORG, "s2");
    await order("o3", ORG, "s2"); // s2: 2 orders
    await order("ox", OTHER, "s1"); // other org → must not leak
  });

describe("suppliers.counts", () => {
  test("tallies assets + orders per supplier, no isActive filter, no cross-org leak", async () => {
    const t = makeT();
    await seed(t);
    const counts = await t.withIdentity(asUser).query(api.suppliers.counts, { orgId: ORG });
    expect(counts).toEqual({
      s1: { assets: 2, orders: 1 }, // a1+a2 (inactive counted), o1; ax/ox other-org excluded
      s2: { assets: 1, orders: 2 },
    });
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.suppliers.counts, { orgId: ORG }),
    ).rejects.toThrow();
  });
});
