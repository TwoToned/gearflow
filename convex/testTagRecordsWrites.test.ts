// @vitest-environment node
//
// convex/testTagRecordsWrites.ts (createNative — the T&T-record state machine) +
// convex/testTagRecords.ts (recordsPage/latestForAsset reads). Verifies the atomic
// fold: record + sub-tests + asset scalars + status recalc + the three failure
// actions (REMOVED_FROM_SERVICE / DISPOSED / REFERRED_TO_ELECTRICIAN) +
// tester-membership + cross-tenant + actor-spoof + viewer RBAC.
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
const DAY = 24 * 60 * 60 * 1000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "admin" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
  });
}
async function seedAsset(t: T, patch: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("testTagAssets", {
      id: "tt1", organizationId: ORG, testTagId: "TT0001", description: "Drill",
      equipmentClass: "CLASS_I", applianceType: "APPLIANCE", status: "NOT_YET_TESTED",
      testIntervalMonths: 3, isActive: true, createdAt: NOW, updatedAt: NOW, ...patch,
    });
  });
}
const tta = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const rec = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const base = {
  orgId: ORG, recordId: "rec1", testTagAssetId: "tt1", testDate: NOW,
  testerName: "Alice", result: "PASS" as const, now: NOW, actor, auditId: "a1",
};

describe("testTagRecordsWrites.createNative", () => {
  test("PASS: record + subtests + asset scalars + status by due date", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    // testProfile the args reference — createNative now org-validates the testProfileId FK.
    await t.run(async (ctx) => {
      await ctx.db.insert("testProfiles", { id: "prof1", organizationId: ORG, name: "Standard", visualChecks: {}, electricalTests: {}, thresholds: {} });
    });
    const res = await t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, nextDueDate: NOW + 60 * DAY, testProfileId: "prof1", outletCount: 4,
      subTests: [
        { id: "s1", label: "Outlet 1", sortOrder: 0, result: "PASS", earthContinuityReading: 0.1 },
        { id: "s2", label: "Outlet 2", sortOrder: 1, result: "PASS" },
      ],
    });
    expect(res.id).toBe("rec1");
    const r = await rec(t, "rec1");
    expect(r?.testedById).toBe(USER);
    expect(r?.result).toBe("PASS");
    expect(r?.visualInspectionResult).toBe("PASS"); // default
    expect(r?.earthContinuityResult).toBe("NOT_APPLICABLE"); // default
    const subs = await t.run(async (ctx) => ctx.db.query("subTestRecords").withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", "rec1")).collect());
    expect(subs).toHaveLength(2);
    expect(subs.find((s) => s.id === "s1")?.earthContinuityReading).toBe(0.1);
    const a = await tta(t, "tt1");
    expect(a?.lastTestDate).toBe(NOW);
    expect(a?.nextDueDate).toBe(NOW + 60 * DAY);
    expect(a?.outletCount).toBe(4);
    expect(a?.testProfileId).toBe("prof1"); // set (asset had none)
    expect(a?.status).toBe("CURRENT"); // far-future due
    // audit
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.action).toBe("CREATE");
    expect(log?.entityType).toBe("testTagRecord");
  });

  test("PASS status: DUE_SOON when due within threshold, OVERDUE when past", async () => {
    const t1 = makeT(); await seed(t1); await seedAsset(t1);
    await t1.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, { ...base, nextDueDate: NOW + 5 * DAY });
    expect((await tta(t1, "tt1"))?.status).toBe("DUE_SOON");

    const t2 = makeT(); await seed(t2); await seedAsset(t2);
    await t2.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, { ...base, nextDueDate: NOW - 1000 });
    expect((await tta(t2, "tt1"))?.status).toBe("OVERDUE");
  });

  test("FAIL + REMOVED_FROM_SERVICE → FAILED", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, result: "FAIL", failureAction: "REMOVED_FROM_SERVICE", nextDueDate: NOW + 60 * DAY,
    });
    expect((await tta(t, "tt1"))?.status).toBe("FAILED");
  });

  test("FAIL + DISPOSED → RETIRED + isActive false (recalc does not override)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, result: "FAIL", failureAction: "DISPOSED", nextDueDate: NOW + 60 * DAY,
    });
    const a = await tta(t, "tt1");
    expect(a?.status).toBe("RETIRED");
    expect(a?.isActive).toBe(false);
  });

  test("FAIL + REFERRED_TO_ELECTRICIAN creates maintenance + link + asset IN_MAINTENANCE", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1" });
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true }); });
    await t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, result: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", failureNotes: "Burnt cord",
      nextDueDate: NOW + 60 * DAY, maintenanceId: "mnt1", maintenanceLinkId: "lnk1",
    });
    const m = await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "mnt1")).first());
    expect(m?.type).toBe("REPAIR");
    expect(m?.status).toBe("SCHEDULED");
    expect(m?.reportedById).toBe(USER);
    const links = await t.run(async (ctx) => ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", "mnt1")).collect());
    expect(links.map((l) => l.assetId)).toEqual(["as1"]);
    expect((await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "as1")).first()))?.status).toBe("IN_MAINTENANCE");
    // recalc: latest record FAILed → testTagAsset FAILED
    expect((await tta(t, "tt1"))?.status).toBe("FAILED");
  });

  test("rejects a non-member testedById", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await expect(t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, testedById: "user_ghost", nextDueDate: NOW + DAY,
    })).rejects.toThrow(/not a member/i);
  });

  test("rejects a cross-org asset", async () => {
    const t = makeT(); await seed(t);
    await seedAsset(t, { organizationId: OTHER });
    await expect(t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, nextDueDate: NOW + DAY,
    })).rejects.toThrow(/not found/i);
  });

  test("actor is pinned to the token: spoofed userId ignored, name from mirror", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, nextDueDate: NOW + 60 * DAY, actor: { userId: "user_evil", userName: "Hacker" },
    });
    const r = await rec(t, "rec1");
    expect(r?.testedById).toBe(USER); // defaulted to verified token subject, not "user_evil"
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.userId).toBe(USER);
    expect(log?.userName).toBe("Alice"); // resolved from users mirror, not "Hacker"
  });

  test("viewer is denied", async () => {
    const t = makeT(); await seed(t, "viewer"); await seedAsset(t);
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.testTagRecordsWrites.createNative, {
      ...base, nextDueDate: NOW + DAY,
    })).rejects.toThrow(/Forbidden|permission/i);
  });

  test("rejects out-of-bounds fields (R-8.6.2 server-side mirror of testTagRecordSchema/subTestRecordSchema)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await expect(t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, nextDueDate: NOW + DAY, testerName: "x".repeat(201),
    })).rejects.toThrow(/Tester name/i);
    await expect(t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, nextDueDate: NOW + DAY, failureNotes: "x".repeat(2001),
    })).rejects.toThrow(/Failure notes/i);
    await expect(t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
      ...base, nextDueDate: NOW + DAY, subTests: [{ id: "s1", label: "x".repeat(101), sortOrder: 0 }],
    })).rejects.toThrow(/Sub-test label/i);
  });
});

describe("testTagRecords reads", () => {
  test("latestForAsset returns the newest record with relations; recordsPage paginates", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("testProfiles", { id: "prof1", organizationId: ORG, name: "Standard", visualChecks: {}, electricalTests: {}, thresholds: {} });
      await ctx.db.insert("testTagRecords", { id: "r1", organizationId: ORG, testTagAssetId: "tt1", testDate: NOW - 2000, testedById: USER, testerName: "Al", result: "PASS", nextDueDate: NOW, testProfileId: "prof1" });
      await ctx.db.insert("testTagRecords", { id: "r2", organizationId: ORG, testTagAssetId: "tt1", testDate: NOW, testedById: USER, testerName: "Al", result: "FAIL", nextDueDate: NOW });
      await ctx.db.insert("subTestRecords", { id: "s1", testTagRecordId: "r1", label: "O1", sortOrder: 0 });
    });
    const latest = await t.withIdentity(asUser).query(api.testTagRecords.latestForAsset, { orgId: ORG, testTagAssetId: "tt1" });
    expect(latest?.id).toBe("r2");
    expect(latest?.testedBy.name).toBe("Alice"); // from users mirror

    const page = await t.withIdentity(asUser).query(api.testTagRecords.recordsPage, { orgId: ORG, testTagAssetId: "tt1", page: 1, pageSize: 1 });
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.records).toHaveLength(1);
    expect(page.records[0].id).toBe("r2"); // testDate desc
    // profile + subtests attach for r1 on page 2
    const page2 = await t.withIdentity(asUser).query(api.testTagRecords.recordsPage, { orgId: ORG, testTagAssetId: "tt1", page: 2, pageSize: 1 });
    expect(page2.records[0].testProfile?.name).toBe("Standard");
    expect(page2.records[0].subTestRecords).toHaveLength(1);
  });

  test("rejects a maintenanceId that already exists in ANOTHER org (no cross-tenant link injection)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1" });
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true });
      // A maintenance record owned by ANOTHER org, whose id the caller tries to reuse.
      await ctx.db.insert("maintenanceRecords", { id: "mForeign", organizationId: OTHER, type: "REPAIR", status: "SCHEDULED", title: "x", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
        ...base, result: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN",
        nextDueDate: NOW + 60 * DAY, maintenanceId: "mForeign", maintenanceLinkId: "lnk1",
      }),
    ).rejects.toThrow();
    // The foreign maintenance record got NO link to this org's asset.
    const links = await t.run(async (ctx) => ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", "mForeign")).collect());
    expect(links).toHaveLength(0);
  });

  test("rejects a sub-test id that collides with a DIFFERENT record's sub-test", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    // A sub-test id already owned by another record.
    await t.run(async (ctx) => { await ctx.db.insert("subTestRecords", { id: "sX", testTagRecordId: "otherRec", label: "L", sortOrder: 0 }); });
    await expect(
      t.withIdentity(asUser).mutation(api.testTagRecordsWrites.createNative, {
        ...base, nextDueDate: NOW + 60 * DAY,
        subTests: [{ id: "sX", label: "Mine", sortOrder: 0, result: "PASS" }],
      }),
    ).rejects.toThrow();
  });
});
