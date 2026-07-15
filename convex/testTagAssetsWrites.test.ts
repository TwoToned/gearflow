// @vitest-environment node
//
// convex/testTagAssetsWrites.ts + convex/testTagAssets.ts (listPage/detail/lookup/
// dashboardStats). Verifies CRUD + counter reserve + audit, the delete cascade
// (records+subtests, RETIRED guard), cross-tenant + RBAC, and the read composites.
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
const tta = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("testTagAssetsWrites", () => {
  test("create reserves a tag id when none supplied + audits", async () => {
    const t = makeT(); await seedMember(t);
    const res = await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.createNative, { id: "tt1", orgId: ORG, description: "Drill", now: NOW, actor, auditId: "a1" });
    expect(res.testTagId).toBe("TT0001");
    const settings = await t.run(async (ctx) => ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).first());
    expect(JSON.parse(settings!.settings!).testTag.counter).toBe(1);
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.action).toBe("CREATE");
  });

  test("create uses the linked asset's tag; rejects a duplicate supplied id", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-9", modelId: "m", isActive: true }); });
    const res = await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.createNative, { id: "tt1", orgId: ORG, description: "d", assetId: "as1", now: NOW, actor, auditId: "a1" });
    expect(res.testTagId).toBe("PA-9");
    // duplicate testTagId rejected
    await expect(t.withIdentity(asUser).mutation(api.testTagAssetsWrites.createNative, { id: "tt2", orgId: ORG, description: "d", testTagId: "PA-9", now: NOW, actor, auditId: "a2" })).rejects.toThrow(/already exists/i);
  });

  test("createFromBulk reserves N ids", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, assetTag: "B", modelId: "m", isActive: true }); });
    const res = await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.createFromBulkNative, { orgId: ORG, bulkAssetId: "b1", ids: ["r1", "r2", "r3"], description: "cable", now: NOW, actor, auditId: "a1" });
    expect(res.count).toBe(3);
    expect(res.items.map((i) => i.testTagId)).toEqual(["TT0001", "TT0002", "TT0003"]);
  });

  test("update patches + clears; retire soft-retires", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, testTagId: "T1", description: "d", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", location: "Shed", status: "NOT_YET_TESTED", isActive: true }); });
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.updateNative, { id: "tt1", orgId: ORG, patch: { description: "d2", location: null }, now: NOW });
    const u = await tta(t, "tt1");
    expect(u?.description).toBe("d2");
    expect(u?.location).toBeUndefined();
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.retireNative, { id: "tt1", orgId: ORG, now: NOW });
    expect((await tta(t, "tt1"))?.status).toBe("RETIRED");
  });

  test("delete requires RETIRED + cascades records/subtests", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, testTagId: "T1", description: "d", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", status: "CURRENT", isActive: true });
      await ctx.db.insert("testTagRecords", { id: "rec1", organizationId: ORG, testTagAssetId: "tt1", testDate: NOW, testedById: USER, testerName: "Al", nextDueDate: NOW });
      await ctx.db.insert("subTestRecords", { id: "st1", testTagRecordId: "rec1", label: "outlet 1" });
    });
    await expect(t.withIdentity(asUser).mutation(api.testTagAssetsWrites.deleteNative, { id: "tt1", orgId: ORG })).rejects.toThrow(/retired/i);
    await t.run(async (ctx) => { const d = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "tt1")).first(); if (d) await ctx.db.patch(d._id, { status: "RETIRED" }); });
    await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.deleteNative, { id: "tt1", orgId: ORG });
    expect(await tta(t, "tt1")).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", "rec1")).first())).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("subTestRecords").withIndex("by_cuid", (q) => q.eq("id", "st1")).first())).toBeNull();
  });

  test("reactivate requires RETIRED; cross-tenant + viewer rejected", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("testTagAssets", { id: "tX", organizationId: OTHER, testTagId: "Z", description: "d", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", status: "RETIRED", isActive: false }); });
    await expect(t.withIdentity(asUser).mutation(api.testTagAssetsWrites.reactivateNative, { id: "tX", orgId: ORG, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.testTagAssetsWrites.createNative, { id: "z", orgId: ORG, description: "d", now: NOW, actor, auditId: "a2" })).rejects.toThrow(/Forbidden|permission/i);
  });

  test("backfill registers T&T for a T&T-model asset", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PA", requiresTestAndTag: true });
      await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m1", isActive: true });
    });
    const res = await t.withIdentity(asUser).mutation(api.testTagAssetsWrites.backfillNative, { orgId: ORG, now: NOW });
    expect(res.created).toBe(1);
    const rows = await t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", "as1")).collect());
    expect(rows).toHaveLength(1);
  });
});

describe("testTagAssets reads", () => {
  async function seed(t: T) {
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m1", isActive: true });
      await ctx.db.insert("testProfiles", { id: "prof1", organizationId: ORG, name: "Standard", visualChecks: {}, electricalTests: {}, thresholds: {} });
      await ctx.db.insert("testProfiles", { id: "prof2", organizationId: ORG, name: "Historical", visualChecks: {}, electricalTests: {}, thresholds: {} });
      await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
      await ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, testTagId: "TT0002", description: "B", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", status: "OVERDUE", nextDueDate: NOW - 1000, assetId: "as1", testProfileId: "prof1", isActive: true });
      await ctx.db.insert("testTagAssets", { id: "tt2", organizationId: ORG, testTagId: "TT0001", description: "A", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", status: "CURRENT", isActive: true });
      await ctx.db.insert("testTagAssets", { id: "ttX", organizationId: OTHER, testTagId: "ZZ", description: "F", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", status: "CURRENT", isActive: true });
      // rec1 tested under prof2 (NOT the asset's current prof1) — detail must still name it.
      await ctx.db.insert("testTagRecords", { id: "rec1", organizationId: ORG, testTagAssetId: "tt1", testDate: NOW, testedById: USER, testerName: "Al", result: "PASS", nextDueDate: NOW, testProfileId: "prof2" });
    });
  }

  test("listPage: tag asc, org-scoped, joins + record count", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).query(api.testTagAssets.listPage, { orgId: ORG, pageSize: 50 });
    expect(res.total).toBe(2); // foreign excluded
    expect(res.items.map((i) => i.testTagId)).toEqual(["TT0001", "TT0002"]); // tag asc
    const withRec = res.items.find((i) => i.id === "tt1");
    expect(withRec?._count.testRecords).toBe(1);
    expect(withRec?.asset?.assetTag).toBe("PA-1");
    expect(withRec?.testProfile?.name).toBe("Standard");
  });

  test("detail: item + records with testedBy name + asset join; null cross-org", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).query(api.testTagAssets.detail, { id: "tt1", orgId: ORG });
    expect(res?.testTagId).toBe("TT0002");
    expect(res?.testRecords[0].testedBy.name).toBe("Alice");
    expect(res?.testRecords[0].testProfile?.name).toBe("Historical"); // record's OWN profile, not the asset's current
    expect(res?.testProfile?.name).toBe("Standard"); // the asset's current profile
    expect(res?.asset?.assetTag).toBe("PA-1");
    expect(await t.withIdentity(asUser).query(api.testTagAssets.detail, { id: "ttX", orgId: ORG })).toBeNull();
  });

  test("lookup: by testTagId incl. latest record", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).query(api.testTagAssets.lookup, { orgId: ORG, testTagId: "TT0002" });
    expect(res?.id).toBe("tt1");
    expect(res?.testRecords).toHaveLength(1);
    expect(await t.withIdentity(asUser).query(api.testTagAssets.lookup, { orgId: ORG, testTagId: "NOPE" })).toBeNull();
  });

  test("dashboardStats: status tallies + overdue list", async () => {
    const t = makeT(); await seed(t);
    const res = await t.withIdentity(asUser).query(api.testTagAssets.dashboardStats, { orgId: ORG, nowMs: NOW });
    expect(res.total).toBe(2);
    expect(res.overdue).toBe(1);
    expect(res.current).toBe(1);
    expect(res.overdueItems.map((i) => i.id)).toEqual(["tt1"]);
    expect(res.recentTests).toHaveLength(1);
    expect(res.recentTests[0].testedBy.name).toBe("Alice");
  });
});
