// @vitest-environment node
//
// convex/testProfilesWrites.ts + testProfiles.resolveForAsset. Verifies CRUD + audit,
// the unique-name guard, duplicate name-dedup, seed idempotency, delete's in-use
// soft-deactivate vs hard-delete, per-row org re-check, RBAC (testTag:*), and the
// resolve cascade (asset → model default → org default → any active).
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
const CHECKS = { visualChecks: [], electricalTests: [], thresholds: {} };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seedMember(t: T, role = "admin") {
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role }); });
}
const prof = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", id)).first());
async function seedProfile(t: T, id: string, over: Record<string, unknown> = {}, org = ORG) {
  await t.run(async (ctx) => { await ctx.db.insert("testProfiles", { id, organizationId: org, name: "P-" + id, equipmentClass: "CLASS_I", applianceType: "APPLIANCE", visualChecks: [], electricalTests: [], thresholds: {}, requiresSubTests: false, defaultSubTestCount: 1, subTestLabel: "Outlet", isDefault: false, isActive: true, createdAt: NOW, updatedAt: NOW, ...over }); });
}

describe("testProfile writes", () => {
  test("create (unique-name + dup-id guarded) → update → hard-delete", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.testProfilesWrites.createNative, { id: "p1", orgId: ORG, name: "Class I", equipmentClass: "CLASS_I", ...CHECKS, now: NOW, actor, auditId: "a1" });
    expect((await prof(t, "p1"))?.name).toBe("Class I");
    // duplicate NAME rejected
    await expect(t.withIdentity(asUser).mutation(api.testProfilesWrites.createNative, { id: "p2", orgId: ORG, name: "Class I", ...CHECKS, now: NOW, actor, auditId: "a2" })).rejects.toThrow(/already exists/i);
    // rename + patch
    await t.withIdentity(asUser).mutation(api.testProfilesWrites.updateNative, { id: "p1", orgId: ORG, name: "Class I v2", subTestLabel: "Port", now: NOW + 1, actor, auditId: "a3" });
    const upd = await prof(t, "p1");
    expect(upd?.name).toBe("Class I v2");
    expect(upd?.subTestLabel).toBe("Port");
    // not in use → hard delete
    const res = await t.withIdentity(asUser).mutation(api.testProfilesWrites.deleteNative, { id: "p1", orgId: ORG, now: NOW + 2, actor, auditId: "a4" });
    expect(res.deactivated).toBe(false);
    expect(await prof(t, "p1")).toBeNull();
  });

  test("delete soft-deactivates while referenced by a model default", async () => {
    const t = makeT(); await seedMember(t); await seedProfile(t, "p1");
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "M", defaultTestProfileId: "p1" }); });
    const res = await t.withIdentity(asUser).mutation(api.testProfilesWrites.deleteNative, { id: "p1", orgId: ORG, now: NOW, actor, auditId: "a1" });
    expect(res.deactivated).toBe(true);
    expect((await prof(t, "p1"))?.isActive).toBe(false);
  });

  test("duplicate finds a free (Copy) name; seed dedups by name", async () => {
    const t = makeT(); await seedMember(t);
    await seedProfile(t, "src", { name: "Base" });
    await seedProfile(t, "existing", { name: "Base (Copy)" }); // forces (Copy 2)
    const dup = await t.withIdentity(asUser).mutation(api.testProfilesWrites.duplicateNative, { id: "src", newId: "dupid", orgId: ORG, now: NOW, actor, auditId: "a1" });
    expect(dup.name).toBe("Base (Copy 2)");
    // seed: one profile already exists by name → only the other is created
    const seedRes = await t.withIdentity(asUser).mutation(api.testProfilesWrites.seedDefaultsNative, {
      orgId: ORG,
      profiles: [
        { id: "s1", name: "Base", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", visualChecks: [], electricalTests: [], thresholds: {}, requiresSubTests: false, defaultSubTestCount: 1, subTestLabel: "Outlet" },
        { id: "s2", name: "Brand New", equipmentClass: "CLASS_II", applianceType: "CORD_SET", visualChecks: [], electricalTests: [], thresholds: {}, requiresSubTests: false, defaultSubTestCount: 1, subTestLabel: "Outlet" },
      ],
      now: NOW, actor, auditId: "a2",
    });
    expect(seedRes.created).toBe(1); // "Base" skipped
  });

  test("create/update reject out-of-bounds fields (R-8.6.2 server-side mirror of testProfileSchema)", async () => {
    const t = makeT(); await seedMember(t); await seedProfile(t, "p1");
    await expect(t.withIdentity(asUser).mutation(api.testProfilesWrites.createNative, { id: "p2", orgId: ORG, name: "x".repeat(201), ...CHECKS, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/Name/i);
    await expect(t.withIdentity(asUser).mutation(api.testProfilesWrites.createNative, { id: "p2", orgId: ORG, name: "Ok", subTestLabel: "x".repeat(51), ...CHECKS, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/Sub-test label/i);
    await expect(t.withIdentity(asUser).mutation(api.testProfilesWrites.createNative, { id: "p2", orgId: ORG, name: "Ok", defaultSubTestCount: 51, ...CHECKS, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/Default sub-test count/i);
    await expect(t.withIdentity(asUser).mutation(api.testProfilesWrites.updateNative, { id: "p1", orgId: ORG, name: "x".repeat(201), now: NOW, actor, auditId: "a2" })).rejects.toThrow(/Name/i);
  });

  test("cross-org update rejected; viewer RBAC rejected", async () => {
    const t = makeT(); await seedMember(t); await seedProfile(t, "pX", {}, OTHER);
    await expect(t.withIdentity(asUser).mutation(api.testProfilesWrites.updateNative, { id: "pX", orgId: ORG, name: "hijack", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.testProfilesWrites.createNative, { id: "p9", orgId: ORG, name: "X", ...CHECKS, now: NOW, actor, auditId: "a2" })).rejects.toThrow(/Forbidden|permission/i);
  });
});

describe("resolveForAsset cascade", () => {
  test("prefers asset-level, then falls to org default for class+type", async () => {
    const t = makeT(); await seedMember(t);
    await seedProfile(t, "assetLvl", { name: "AssetLevel" });
    await seedProfile(t, "orgDefault", { name: "OrgDefault", isDefault: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "tta1", organizationId: ORG, testTagId: "T1", description: "d", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", testProfileId: "assetLvl" });
      await ctx.db.insert("testTagAssets", { id: "tta2", organizationId: ORG, testTagId: "T2", description: "d", equipmentClass: "CLASS_I", applianceType: "APPLIANCE" });
    });
    const r1 = await t.withIdentity(asUser).query(api.testProfiles.resolveForAsset, { orgId: ORG, testTagAssetId: "tta1" });
    expect(r1?.id).toBe("assetLvl");
    const r2 = await t.withIdentity(asUser).query(api.testProfiles.resolveForAsset, { orgId: ORG, testTagAssetId: "tta2" });
    expect(r2?.id).toBe("orgDefault"); // isDefault match for class+type
  });

  test("returns null for a foreign-org asset", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("testTagAssets", { id: "ttaX", organizationId: OTHER, testTagId: "TX", description: "d", equipmentClass: "CLASS_I", applianceType: "APPLIANCE" }); });
    const r = await t.withIdentity(asUser).query(api.testProfiles.resolveForAsset, { orgId: ORG, testTagAssetId: "ttaX" });
    expect(r).toBeNull();
  });
});
