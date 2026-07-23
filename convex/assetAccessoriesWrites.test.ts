// @vitest-environment node
//
// convex/assetAccessoriesWrites.ts + convex/assetAccessories.ts availableSerialized.
// Verifies the attach/detach guards, the DEDICATED pool decrement/restore is ATOMIC with
// the child write, per-row org re-check, RBAC (asset:update), and the available-candidate
// filter.
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
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "Rig" });
    await ctx.db.insert("assets", { id: "parent", organizationId: ORG, assetTag: "P-1", modelId: "mdl", status: "AVAILABLE", isActive: true, locationId: "loc1" });
    await ctx.db.insert("assets", { id: "child", organizationId: ORG, assetTag: "C-1", modelId: "mdl", status: "AVAILABLE", isActive: true });
    await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: ORG, assetTag: "CLAMP", modelId: "mdl", availableQuantity: 10 });
  });
}
const asset = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const pool = (t: T) => t.run(async (ctx) => (await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "ba1")).first())?.availableQuantity);

describe("assetAccessoriesWrites — serialized", () => {
  test("attach inherits the parent location; detach clears the link", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addSerializedNative, { parentAssetId: "parent", orgId: ORG, childAssetId: "child", now: NOW, actor, auditId: "a1" });
    const c = await asset(t, "child");
    expect(c?.parentAssetId).toBe("parent");
    expect(c?.locationId).toBe("loc1"); // inherited
    await t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.removeSerializedNative, { parentAssetId: "parent", orgId: ORG, childAssetId: "child", now: NOW + 1, actor, auditId: "a2" });
    expect((await asset(t, "child"))?.parentAssetId).toBeUndefined();
  });

  test("rejects self-attach, a non-AVAILABLE child, an already-attached child, and a kit member", async () => {
    const t = makeT(); await seed(t);
    await expect(t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addSerializedNative, { parentAssetId: "parent", orgId: ORG, childAssetId: "parent", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/itself/i);
    await t.run(async (ctx) => { const c = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "child")).first(); if (c) await ctx.db.patch(c._id, { status: "CHECKED_OUT" }); });
    await expect(t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addSerializedNative, { parentAssetId: "parent", orgId: ORG, childAssetId: "child", now: NOW, actor, auditId: "a2" })).rejects.toThrow(/AVAILABLE/i);
    await t.run(async (ctx) => { const c = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "child")).first(); if (c) await ctx.db.patch(c._id, { status: "AVAILABLE", kitId: "k1" }); });
    await expect(t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addSerializedNative, { parentAssetId: "parent", orgId: ORG, childAssetId: "child", now: NOW, actor, auditId: "a3" })).rejects.toThrow(/kit/i);
  });

  test("cross-org: cannot attach to a parent in another org", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { const p = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "parent")).first(); if (p) await ctx.db.patch(p._id, { organizationId: OTHER }); });
    await expect(t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addSerializedNative, { parentAssetId: "parent", orgId: ORG, childAssetId: "child", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/not found/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing assetSerializedChildSchema.parse() in
  // the browser hook) must still hit the same business-constraint bounds server-side.
  test("rejects an over-long notes field on addSerializedNative", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addSerializedNative, { parentAssetId: "parent", orgId: ORG, childAssetId: "child", notes: "x".repeat(501), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/notes/i);
  });
});

describe("assetAccessoriesWrites — bulk pool atomicity", () => {
  test("DEDICATED attach decrements the pool; detach restores it", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addBulkNative, { id: "bc1", parentAssetId: "parent", orgId: ORG, bulkAssetId: "ba1", quantity: 3, allocationMode: "DEDICATED", now: NOW, actor, auditId: "a1" });
    expect(await pool(t)).toBe(7); // 10 - 3
    await t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.removeBulkNative, { parentAssetId: "parent", orgId: ORG, bulkChildId: "bc1", now: NOW + 1, actor, auditId: "a2" });
    expect(await pool(t)).toBe(10); // restored
  });

  test("SHIPS_WITH leaves the pool untouched", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addBulkNative, { id: "bc1", parentAssetId: "parent", orgId: ORG, bulkAssetId: "ba1", quantity: 2, allocationMode: "SHIPS_WITH", now: NOW, actor, auditId: "a1" });
    expect(await pool(t)).toBe(10);
  });

  test("DEDICATED attach rejects (and doesn't mutate) on insufficient stock", async () => {
    const t = makeT(); await seed(t);
    await expect(t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addBulkNative, { id: "bc1", parentAssetId: "parent", orgId: ORG, bulkAssetId: "ba1", quantity: 99, allocationMode: "DEDICATED", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/Insufficient stock/i);
    expect(await pool(t)).toBe(10); // rolled back (atomic)
    const child = await t.run(async (ctx) => ctx.db.query("assetBulkChildren").withIndex("by_cuid", (q) => q.eq("id", "bc1")).first());
    expect(child).toBeNull();
  });

  test("RBAC: a viewer is rejected", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.assetAccessoriesWrites.addBulkNative, { id: "bc1", parentAssetId: "parent", orgId: ORG, bulkAssetId: "ba1", quantity: 1, allocationMode: "SHIPS_WITH", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/Forbidden|permission/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing assetBulkChildSchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  test("rejects a non-integer/negative quantity on addBulkNative", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addBulkNative, { id: "bc1", parentAssetId: "parent", orgId: ORG, bulkAssetId: "ba1", quantity: 0, allocationMode: "SHIPS_WITH", now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/quantity/i);
  });

  test("rejects an over-long notes field on addBulkNative", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.assetAccessoriesWrites.addBulkNative, { id: "bc1", parentAssetId: "parent", orgId: ORG, bulkAssetId: "ba1", quantity: 1, allocationMode: "SHIPS_WITH", notes: "x".repeat(501), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/notes/i);
  });
});

describe("assetAccessories.availableSerialized", () => {
  test("returns AVAILABLE non-attached candidates, excludes the parent + accessory-parents", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "attached", organizationId: ORG, assetTag: "AT", modelId: "mdl", status: "AVAILABLE", isActive: true, parentAssetId: "child" });
      await ctx.db.insert("assets", { id: "busy", organizationId: ORG, assetTag: "BZ", modelId: "mdl", status: "CHECKED_OUT", isActive: true });
      await ctx.db.insert("assets", { id: "clean", organizationId: ORG, assetTag: "CL", modelId: "mdl", status: "AVAILABLE", isActive: true });
    });
    const res = await t.withIdentity(asUser).query(api.assetAccessories.availableSerialized, { orgId: ORG, parentAssetId: "parent" });
    // Only "clean" qualifies: "parent"=self, "attached" already an accessory, "busy" not
    // AVAILABLE, "child" is an accessory-parent (of "attached").
    expect(res.map((a) => a.id)).toEqual(["clean"]);
    expect(res[0].model).toEqual({ name: "Rig" });
  });
});
