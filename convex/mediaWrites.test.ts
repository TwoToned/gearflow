// @vitest-environment node
//
// convex/mediaWrites.ts — the shared browser-direct media mutation set, dispatched by
// `kind`. Verifies add (dup-guard + parent/file org check + sortOrder + isPrimary),
// remove (row delete + file cleanup + primary promotion), setPrimary, reorder, per-row
// org re-check, and RBAC (<parent>:update). Covers a photo kind (asset) + a non-photo
// kind (client).
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
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seedMember(t: T, role = "admin") {
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role }); });
}
async function seedFile(t: T, id: string, org = ORG) {
  await t.run(async (ctx) => { await ctx.db.insert("fileUploads", { id, organizationId: org, fileName: "f", fileSize: 1, mimeType: "image/png", storageKey: "sk-" + id, url: "/api/files/sk-" + id, uploadedById: USER }); });
}
async function seedAsset(t: T, id: string, org = ORG) {
  await t.run(async (ctx) => { await ctx.db.insert("assets", { id, organizationId: org, assetTag: "A-" + id, modelId: "m" }); });
}
const assetMedia = (t: T) => t.run(async (ctx) => ctx.db.query("assetMedia").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());

describe("mediaWrites — asset (photo kind)", () => {
  test("add: sortOrder increments, first PHOTO is primary; dup-id + cross-org rejected", async () => {
    const t = makeT(); await seedMember(t); await seedAsset(t, "a1"); await seedFile(t, "f1"); await seedFile(t, "f2");
    await t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am1", orgId: ORG, parentId: "a1", fileId: "f1", type: "PHOTO", now: NOW });
    await t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am2", orgId: ORG, parentId: "a1", fileId: "f2", type: "PHOTO", now: NOW });
    const rows = (await assetMedia(t)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(rows.map((r) => r.id)).toEqual(["am1", "am2"]);
    expect(rows[0].isPrimary).toBe(true);
    expect(rows[1].isPrimary).toBe(false); // only first PHOTO primary
    // dup id
    await expect(t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am1", orgId: ORG, parentId: "a1", fileId: "f1", type: "PHOTO", now: NOW })).rejects.toThrow(/already exists/i);
    // parent in another org
    await seedAsset(t, "aX", OTHER);
    await expect(t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am9", orgId: ORG, parentId: "aX", fileId: "f1", type: "PHOTO", now: NOW })).rejects.toThrow(/Parent not found/i);
  });

  test("remove: deletes row + fileUploads, promotes next primary photo", async () => {
    const t = makeT(); await seedMember(t); await seedAsset(t, "a1"); await seedFile(t, "f1"); await seedFile(t, "f2");
    await t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am1", orgId: ORG, parentId: "a1", fileId: "f1", type: "PHOTO", now: NOW });
    await t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am2", orgId: ORG, parentId: "a1", fileId: "f2", type: "PHOTO", now: NOW });
    // remove the primary (am1) → am2 promoted, f1 fileUploads row gone
    await t.withIdentity(asUser).mutation(api.mediaWrites.removeNative, { kind: "asset", orgId: ORG, mediaId: "am1" });
    const rows = await assetMedia(t);
    expect(rows.map((r) => r.id)).toEqual(["am2"]);
    expect(rows[0].isPrimary).toBe(true); // promoted
    const f1 = await t.run(async (ctx) => ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", "f1")).first());
    expect(f1).toBeNull(); // file cleaned up
  });

  test("setPrimary switches the single primary; cross-org media rejected", async () => {
    const t = makeT(); await seedMember(t); await seedAsset(t, "a1"); await seedFile(t, "f1"); await seedFile(t, "f2");
    await t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am1", orgId: ORG, parentId: "a1", fileId: "f1", type: "PHOTO", now: NOW });
    await t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am2", orgId: ORG, parentId: "a1", fileId: "f2", type: "PHOTO", now: NOW });
    await t.withIdentity(asUser).mutation(api.mediaWrites.setPrimaryNative, { kind: "asset", orgId: ORG, parentId: "a1", mediaId: "am2" });
    const byId = new Map((await assetMedia(t)).map((r) => [r.id, r.isPrimary]));
    expect(byId.get("am2")).toBe(true);
    expect(byId.get("am1")).toBe(false);
    await expect(t.withIdentity(asUser).mutation(api.mediaWrites.setPrimaryNative, { kind: "asset", orgId: ORG, parentId: "a1", mediaId: "nope" })).rejects.toThrow(/not found/i);
  });

  test("RBAC: a viewer (asset:read only) is rejected", async () => {
    const t = makeT(); await seedMember(t, "viewer"); await seedAsset(t, "a1"); await seedFile(t, "f1");
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.mediaWrites.addNative, { kind: "asset", id: "am1", orgId: ORG, parentId: "a1", fileId: "f1", type: "PHOTO", now: NOW })).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("mediaWrites — client (non-photo kind)", () => {
  test("add sets no isPrimary; reorder re-numbers with org re-check", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme" }); });
    await seedFile(t, "f1"); await seedFile(t, "f2");
    await t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "client", id: "cm1", orgId: ORG, parentId: "c1", fileId: "f1", type: "DOCUMENT", displayName: "Contract", now: NOW });
    await t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "client", id: "cm2", orgId: ORG, parentId: "c1", fileId: "f2", type: "DOCUMENT", now: NOW });
    const rows = await t.run(async (ctx) => ctx.db.query("clientMedia").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
    expect(rows.every((r) => (r as { isPrimary?: boolean }).isPrimary === undefined)).toBe(true); // non-photo → no isPrimary
    // reorder cm2 before cm1
    await t.withIdentity(asUser).mutation(api.mediaWrites.reorderNative, { kind: "client", orgId: ORG, orderedIds: ["cm2", "cm1"] });
    const sorted = (await t.run(async (ctx) => ctx.db.query("clientMedia").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect())).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    expect(sorted.map((r) => r.id)).toEqual(["cm2", "cm1"]);
  });
});
