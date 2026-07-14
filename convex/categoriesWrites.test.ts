// @vitest-environment node
//
// convex/categoriesWrites.ts (create/update/removeNative) + convex/categories.ts
// (detail composite + containerAssetSearch). Verifies delete-guards (children/models
// block), per-row org re-check, RBAC (model:*), cross-tenant, the deep detail counts +
// primary photo, and the container-asset search (prepKitCategoryId + descendants).
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

const cats = (t: T) => t.run(async (ctx) => ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());

describe("categoriesWrites", () => {
  test("create → update → delete, with audit", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.categoriesWrites.createNative, { id: "c1", orgId: ORG, name: "Audio", now: NOW, actor, auditId: "a1" });
    expect((await cats(t))[0].name).toBe("Audio");
    await t.withIdentity(asUser).mutation(api.categoriesWrites.updateNative, { id: "c1", orgId: ORG, name: "Audio+", now: NOW + 1, actor, auditId: "a2" });
    expect((await cats(t))[0].name).toBe("Audio+");
    await t.withIdentity(asUser).mutation(api.categoriesWrites.removeNative, { id: "c1", orgId: ORG, now: NOW + 2, actor, auditId: "a3" });
    expect(await cats(t)).toHaveLength(0);
  });

  test("delete is blocked by subcategories, then by models", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("categories", { id: "c1", organizationId: ORG, name: "Parent", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("categories", { id: "c2", organizationId: ORG, name: "Child", parentId: "c1", createdAt: NOW, updatedAt: NOW });
    });
    await expect(t.withIdentity(asUser).mutation(api.categoriesWrites.removeNative, { id: "c1", orgId: ORG, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/subcategories/i);
    // Remove the child, add a model → now the model guard blocks.
    await t.run(async (ctx) => {
      const child = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", "c2")).first();
      if (child) await ctx.db.delete(child._id);
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Mixer", categoryId: "c1" });
    });
    await expect(t.withIdentity(asUser).mutation(api.categoriesWrites.removeNative, { id: "c1", orgId: ORG, now: NOW, actor, auditId: "a2" })).rejects.toThrow(/models/i);
  });

  test("update rejects a category in another org; RBAC rejects a viewer", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("categories", { id: "cX", organizationId: OTHER, name: "Theirs", createdAt: NOW, updatedAt: NOW }); });
    await expect(t.withIdentity(asUser).mutation(api.categoriesWrites.updateNative, { id: "cX", orgId: ORG, name: "hijack", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.categoriesWrites.createNative, { id: "c1", orgId: ORG, name: "X", now: NOW, actor, auditId: "a2" })).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("categories.detail composite", () => {
  test("assembles parent, children (+counts), kits (+member counts), models (+asset count & photo)", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("categories", { id: "root", organizationId: ORG, name: "Root", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("categories", { id: "c1", organizationId: ORG, name: "Cameras", parentId: "root", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("categories", { id: "c1a", organizationId: ORG, name: "DSLR", parentId: "c1", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "A7", categoryId: "c1", isActive: true });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", isActive: true });
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Kit", categoryId: "c1" });
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: "u1" });
      await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, url: "u://p", thumbnailUrl: "u://t", fileName: "p.jpg", mimeType: "image/jpeg", fileSize: 1, storageKey: "k1", uploadedById: "u1" });
      await ctx.db.insert("modelMedia", { id: "mm1", organizationId: ORG, modelId: "m1", fileId: "f1", type: "PHOTO", isPrimary: true, sortOrder: 0 });
    });
    const d = await t.withIdentity(asUser).query(api.categories.detail, { id: "c1", orgId: ORG });
    expect(d.parent?.id).toBe("root");
    expect(d._count).toEqual({ models: 1, kits: 1, children: 1 });
    expect(d.children.map((c) => c.id)).toEqual(["c1a"]);
    expect(d.kits[0]._count).toEqual({ serializedItems: 1, bulkItems: 0 });
    expect(d.models[0]._count.assets).toBe(1);
    expect(d.models[0].media).toEqual([{ url: "u://p", thumbnailUrl: "u://t" }]);
  });

  test("cross-tenant: cannot read another org's category detail", async () => {
    const t = makeT(); await seedMember(t);
    await expect(t.withIdentity({ subject: "x", orgId: OTHER }).query(api.categories.detail, { id: "c1", orgId: ORG })).rejects.toThrow(/Forbidden|organization/i);
  });
});

describe("categories.containerAssetSearch", () => {
  test("searches assets in the configured container category + descendants", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgSettings", { organizationId: ORG, settings: JSON.stringify({ prepKitCategoryId: "cases" }) });
      await ctx.db.insert("categories", { id: "cases", organizationId: ORG, name: "Cases", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("categories", { id: "flight", organizationId: ORG, name: "Flight", parentId: "cases", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Roadcase", categoryId: "flight" });
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Mixer", categoryId: "other" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "CASE-1", isActive: true });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m2", assetTag: "MIX-1", isActive: true });
    });
    const res = await t.withIdentity(asUser).query(api.categories.containerAssetSearch, { orgId: ORG, query: "" });
    expect(res.map((r) => r.assetId)).toEqual(["a1"]); // only the container-category asset
    expect(res[0].label).toBe("Roadcase — CASE-1");
  });

  test("returns [] when no container category is configured", async () => {
    const t = makeT(); await seedMember(t);
    expect(await t.withIdentity(asUser).query(api.categories.containerAssetSearch, { orgId: ORG, query: "" })).toEqual([]);
  });
});
