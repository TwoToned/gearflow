// @vitest-environment node
//
// convex/bulkAssetsWrites.ts + convex/bulkAssets.ts (listPage/detail). Verifies
// CRUD + audit, dup-tag + dup-id guards, availableQuantity recompute, counter
// bumps, the delete reference guards (line items → kit membership), the
// reserveAssetTagCounter advance, cross-tenant + RBAC, and the list/detail reads.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
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
  registerShardedCounter(t, "shardedCounter");
  return t;
}
async function seedMember(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    // Model the `base` fixture (modelId "mdl1") references — createNative/updateNative now
    // org-validate the modelId FK, so the referenced model must exist in the org.
    await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Cable" });
  });
}
const bulk = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const base = { id: "bk1", orgId: ORG, modelId: "mdl1", assetTag: "BK-1", totalQuantity: 5, now: NOW, actor, auditId: "a1" } as const;

describe("bulkAssetsWrites", () => {
  test("create sets available=total, advances the tag counter, audits", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, base);
    const c = await bulk(t, "bk1");
    expect(c?.totalQuantity).toBe(5);
    expect(c?.availableQuantity).toBe(5);
    const settings = await t.run(async (ctx) => ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).first());
    expect(JSON.parse(settings!.settings!).assetTagCounter).toBe(1); // advanced
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.action).toBe("CREATE");
  });

  test("dup id + dup tag rejected", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, base);
    await expect(t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, { ...base, auditId: "a2" })).rejects.toThrow(/already exists/i);
    await expect(t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, { ...base, id: "bk2", auditId: "a3" })).rejects.toThrow(/already exists/i); // dup tag
  });

  test("update recomputes availableQuantity from the total delta", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, base); // total 5, avail 5
    // simulate some deployed (avail 3)
    await t.run(async (ctx) => { const d = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "bk1")).first(); if (d) await ctx.db.patch(d._id, { availableQuantity: 3 }); });
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.updateNative, { ...base, totalQuantity: 8, now: NOW + 1, auditId: "a2" }); // +3 total
    const u = await bulk(t, "bk1");
    expect(u?.totalQuantity).toBe(8);
    expect(u?.availableQuantity).toBe(6); // 3 + (8-5)
  });

  test("update dup-tag guard only when tag changes; cross-tenant rejected", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, base);
    await t.run(async (ctx) => { await ctx.db.insert("bulkAssets", { id: "bk2", organizationId: ORG, assetTag: "TAKEN", modelId: "mdl1" }); });
    await expect(t.withIdentity(asUser).mutation(api.bulkAssetsWrites.updateNative, { ...base, assetTag: "TAKEN", now: NOW + 1, auditId: "a2" })).rejects.toThrow(/already exists/i);
    await t.run(async (ctx) => { await ctx.db.insert("bulkAssets", { id: "bkX", organizationId: OTHER, assetTag: "Z", modelId: "mdl1" }); });
    await expect(t.withIdentity(asUser).mutation(api.bulkAssetsWrites.updateNative, { ...base, id: "bkX", now: NOW + 1, auditId: "a3" })).rejects.toThrow(/not found/i);
  });

  test("delete blocked by line items then kit membership, else deletes + audits", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, base);
    await t.run(async (ctx) => { await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p", bulkAssetId: "bk1", status: "CONFIRMED", quantity: 1, type: "EQUIPMENT" }); });
    await expect(t.withIdentity(asUser).mutation(api.bulkAssetsWrites.deleteNative, { id: "bk1", orgId: ORG, now: NOW, actor, auditId: "d1" })).rejects.toThrow(/line items/i);
    await t.run(async (ctx) => { const li = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "li1")).first(); if (li) await ctx.db.delete(li._id); await ctx.db.insert("kitBulkItems", { id: "kb1", organizationId: ORG, kitId: "k1", bulkAssetId: "bk1", quantity: 1, addedById: USER }); });
    await expect(t.withIdentity(asUser).mutation(api.bulkAssetsWrites.deleteNative, { id: "bk1", orgId: ORG, now: NOW, actor, auditId: "d2" })).rejects.toThrow(/part of a kit/i);
    await t.run(async (ctx) => { const kb = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", "kb1")).first(); if (kb) await ctx.db.delete(kb._id); });
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.deleteNative, { id: "bk1", orgId: ORG, now: NOW, actor, auditId: "d3" });
    expect(await bulk(t, "bk1")).toBeNull();
  });

  test("archive soft-retires (no audit, parity); RBAC rejects a viewer", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, base);
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.archiveNative, { id: "bk1", orgId: ORG, now: NOW + 5 });
    const a = await bulk(t, "bk1");
    expect(a?.isActive).toBe(false);
    expect(a?.status).toBe("RETIRED");
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.bulkAssetsWrites.createNative, { ...base, id: "bk9", assetTag: "X", auditId: "a9" })).rejects.toThrow(/Forbidden|permission/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing bulkAssetSchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  test("rejects an assetTag over the 50-char bound", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, { ...base, assetTag: "X".repeat(51) }),
    ).rejects.toThrow(/assetTag/);
  });

  test("rejects a negative purchasePricePerUnit", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, { ...base, purchasePricePerUnit: -1 }),
    ).rejects.toThrow(/purchasePricePerUnit/);
  });

  test("rejects a notes field over the 2000-char bound on updateNative", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, base);
    await expect(
      t.withIdentity(asUser).mutation(api.bulkAssetsWrites.updateNative, { ...base, notes: "x".repeat(2001), now: NOW + 1, auditId: "a2" }),
    ).rejects.toThrow(/notes/i);
  });

  test("rejects a negative totalQuantity", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.bulkAssetsWrites.createNative, { ...base, totalQuantity: -1 }),
    ).rejects.toThrow(/totalQuantity/);
  });
});

describe("bulkAssets reads", () => {
  test("listPage: active only, tag asc, with model+location, org-scoped", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      // model "mdl1" (name "Cable") is already seeded by seedMember.
      await ctx.db.insert("locations", { id: "loc1", organizationId: ORG, name: "Warehouse", type: "WAREHOUSE" });
      await ctx.db.insert("bulkAssets", { id: "b2", organizationId: ORG, assetTag: "B", modelId: "mdl1", locationId: "loc1", isActive: true });
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, assetTag: "A", modelId: "mdl1", isActive: true });
      await ctx.db.insert("bulkAssets", { id: "b3", organizationId: ORG, assetTag: "C", modelId: "mdl1", isActive: false }); // excluded (inactive)
      await ctx.db.insert("bulkAssets", { id: "bX", organizationId: OTHER, assetTag: "Z", modelId: "mdl1", isActive: true }); // foreign
    });
    const res = await t.withIdentity(asUser).query(api.bulkAssets.listPage, { orgId: ORG, pageSize: 100 });
    expect(res.total).toBe(2);
    expect(res.bulkAssets.map((b) => b.id)).toEqual(["b1", "b2"]); // tag asc
    expect(res.bulkAssets[0].model?.name).toBe("Cable");
    expect(res.bulkAssets[1].location?.name).toBe("Warehouse");
  });

  test("detail: returns scalars incl modelId; null for missing", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, assetTag: "A", modelId: "mdl9", isActive: true }); });
    const res = await t.withIdentity(asUser).query(api.bulkAssets.detail, { id: "b1", orgId: ORG });
    expect(res?.modelId).toBe("mdl9");
    expect(await t.withIdentity(asUser).query(api.bulkAssets.detail, { id: "nope", orgId: ORG })).toBeNull();
  });
});
