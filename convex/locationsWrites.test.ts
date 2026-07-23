// @vitest-environment node
//
// convex/locationsWrites.ts + convex/locations.ts (detail/listSimple). Verifies the
// single-default invariant, delete-guards (children / assets block), media cascade,
// per-row org re-check, RBAC (location:*), cross-tenant, and the detail composite.
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
const locs = (t: T) => t.run(async (ctx) => ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());

describe("locationsWrites", () => {
  test("create with isDefault clears any prior default (single-default invariant)", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("locations", { id: "l0", organizationId: ORG, name: "Old", isDefault: true, createdAt: NOW, updatedAt: NOW }); });
    await t.withIdentity(asUser).mutation(api.locationsWrites.createNative, { id: "l1", orgId: ORG, name: "New", isDefault: true, now: NOW, actor, auditId: "a1" });
    const all = await locs(t);
    expect(all.find((l) => l.id === "l0")?.isDefault).toBe(false);
    expect(all.find((l) => l.id === "l1")?.isDefault).toBe(true);
  });

  test("delete is blocked by sub-locations, then by assigned assets, then succeeds + cascades media", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("locations", { id: "l1", organizationId: ORG, name: "WH", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("locations", { id: "l2", organizationId: ORG, name: "Shelf", parentId: "l1", createdAt: NOW, updatedAt: NOW });
    });
    await expect(t.withIdentity(asUser).mutation(api.locationsWrites.removeNative, { id: "l1", orgId: ORG, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/sub-locations/i);
    await t.run(async (ctx) => {
      const c = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", "l2")).first(); if (c) await ctx.db.delete(c._id);
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A-1", locationId: "l1", modelId: "m0", isActive: true });
    });
    await expect(t.withIdentity(asUser).mutation(api.locationsWrites.removeNative, { id: "l1", orgId: ORG, now: NOW, actor, auditId: "a2" })).rejects.toThrow(/assets assigned/i);
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first(); if (asset) await ctx.db.delete(asset._id);
      await ctx.db.insert("locationMedia", { id: "lm1", organizationId: ORG, locationId: "l1", fileId: "f1", type: "DOCUMENT", sortOrder: 0 });
    });
    await t.withIdentity(asUser).mutation(api.locationsWrites.removeNative, { id: "l1", orgId: ORG, now: NOW, actor, auditId: "a3" });
    expect(await locs(t)).toHaveLength(0);
    const media = await t.run(async (ctx) => ctx.db.query("locationMedia").withIndex("by_locationId", (q) => q.eq("locationId", "l1")).collect());
    expect(media).toHaveLength(0); // cascaded
  });

  test("update rejects a location in another org; RBAC rejects a viewer", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("locations", { id: "lX", organizationId: OTHER, name: "Theirs", createdAt: NOW, updatedAt: NOW }); });
    await expect(t.withIdentity(asUser).mutation(api.locationsWrites.updateNative, { id: "lX", orgId: ORG, name: "hijack", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.locationsWrites.createNative, { id: "l1", orgId: ORG, name: "X", now: NOW, actor, auditId: "a2" })).rejects.toThrow(/Forbidden|permission/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing locationSchema.parse() in the browser
  // hook) must still hit the same business-constraint bounds server-side.
  test("rejects a name over the 200-char bound", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.locationsWrites.createNative, { id: "l1", orgId: ORG, name: "X".repeat(201), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/name/i);
  });

  test("rejects an over-long notes field on updateNative", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("locations", { id: "l1", organizationId: ORG, name: "WH", createdAt: NOW, updatedAt: NOW }); });
    await expect(
      t.withIdentity(asUser).mutation(api.locationsWrites.updateNative, { id: "l1", orgId: ORG, name: "WH", notes: "x".repeat(1001), now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/notes/i);
  });

  test("rejects latitude supplied without longitude (the refine cross-field check)", async () => {
    const t = makeT(); await seedMember(t);
    await expect(
      t.withIdentity(asUser).mutation(api.locationsWrites.createNative, { id: "l1", orgId: ORG, name: "WH", latitude: 1.23, now: NOW, actor, auditId: "a1" }),
    ).rejects.toThrow(/latitude and longitude/i);
  });

  test("rejects an over-long notes field on updateNotesNative", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("locations", { id: "l1", organizationId: ORG, name: "WH", createdAt: NOW, updatedAt: NOW }); });
    await expect(
      t.withIdentity(asUser).mutation(api.locationsWrites.updateNotesNative, { id: "l1", orgId: ORG, notes: "x".repeat(1001), now: NOW, actor }),
    ).rejects.toThrow(/notes/i);
  });
});

describe("locations.detail + listSimple", () => {
  test("detail assembles parent, children+counts, assets/bulk/kits, projects+client, media", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("locations", { id: "root", organizationId: ORG, name: "Root", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("locations", { id: "l1", organizationId: ORG, name: "WH", parentId: "root", type: "WAREHOUSE", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("locations", { id: "l1a", organizationId: ORG, name: "Bay", parentId: "l1", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Mixer" });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A-1", locationId: "l1", modelId: "m1", isActive: true, status: "AVAILABLE" });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, assetTag: "A-2", locationId: "l1a", modelId: "m1", isActive: true });
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K-1", name: "Kit", locationId: "l1", isActive: true });
      await ctx.db.insert("clients", { id: "cl1", organizationId: ORG, name: "Acme" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, locationId: "l1", clientId: "cl1", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, url: "u://p", thumbnailUrl: "u://t", fileName: "p.pdf", fileSize: 9, mimeType: "application/pdf", storageKey: "k", uploadedById: "u1" });
      await ctx.db.insert("locationMedia", { id: "lm1", organizationId: ORG, locationId: "l1", fileId: "f1", type: "DOCUMENT", sortOrder: 0, createdAt: NOW });
    });
    const d = (await t.withIdentity(asUser).query(api.locations.detail, { id: "l1", orgId: ORG }))!;
    expect(d.parent?.id).toBe("root");
    expect(d._count).toEqual({ assets: 1, bulkAssets: 0, kits: 1, children: 1, projects: 1 });
    expect(d.children[0]).toEqual({ id: "l1a", name: "Bay", _count: { assets: 1, bulkAssets: 0 } });
    expect(d.assets[0]).toEqual({ id: "a1", assetTag: "A-1", status: "AVAILABLE", model: { name: "Mixer" } });
    expect(d.projects[0].client).toEqual({ name: "Acme" });
    expect(d.projects[0].createdAt).toBe(new Date(NOW).toISOString());
    expect(d.media[0].file?.url).toBe("u://p");
  });

  test("detail returns null for a missing location (parity, no throw)", async () => {
    const t = makeT(); await seedMember(t);
    expect(await t.withIdentity(asUser).query(api.locations.detail, { id: "nope", orgId: ORG })).toBeNull();
  });

  test("listSimple returns id/name/type name-asc; cross-tenant rejected", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("locations", { id: "b", organizationId: ORG, name: "Beta", type: "VENUE", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("locations", { id: "a", organizationId: ORG, name: "Alpha", createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(asUser).query(api.locations.listSimple, { orgId: ORG });
    expect(res.map((l) => l.name)).toEqual(["Alpha", "Beta"]);
    await expect(t.withIdentity({ subject: "x", orgId: OTHER }).query(api.locations.listSimple, { orgId: ORG })).rejects.toThrow(/Forbidden|organization/i);
  });
});
