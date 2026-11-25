// @vitest-environment node
//
// convex/testTagRecordsWrites.ts (createNative — the T&T-record state machine — and
// its exact reverse undoCreateNative) + convex/testTagRecords.ts reads. Verifies the
// atomic fold (record + sub-tests + asset scalars + status recalc + the three failure
// actions) and Phase 16's server authority: the DERIVED next-due date (D52, incl. a
// fail), the D51 reading guards (a blank enabled reading is rejected, an explicit N/A
// is not), the DERIVED overall result, the three newly stored readings, and the exact
// Undo (restores every field, refuses when anything changed, 10-minute server window,
// org-checked). Plus tester-membership, cross-tenant, actor-spoof and viewer RBAC.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect, vi, afterEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { FunctionArgs } from "convex/server";
import { deriveNextDueDate } from "./lib/testTagNextDue";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const USER2 = "user_2";
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
/** A Class I profile: earth (< 1 Ω) and insulation (≥ 1 MΩ) enabled, leakage off. */
const CLASS_I_TESTS = [
  { key: "earthContinuity", label: "Earth Continuity", threshold: 1.0, operator: "lt", unit: "Ω", enabled: true },
  { key: "insulationResistance", label: "Insulation Resistance", threshold: 1.0, operator: "gte", unit: "MΩ", enabled: true },
  { key: "leakageCurrent", label: "Leakage Current", threshold: 5.0, operator: "lte", unit: "mA", enabled: false },
];
async function seedProfile(t: T, patch: Record<string, unknown> = {}, id = "prof1", org = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("testProfiles", {
      // Matches seedAsset's class + type, so it is the asset's RESOLVED profile (the only
      // one a test may be held to — a caller can't pick another).
      id, organizationId: org, name: "Class I", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", isActive: true, isDefault: true,
      visualChecks: [], electricalTests: CLASS_I_TESTS, thresholds: {}, ...patch,
    });
  });
}
const tta = (t: T, id = "tt1") => t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const rec = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("testTagRecords").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const log = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const subsOf = (t: T, recordId: string) => t.run(async (ctx) => ctx.db.query("subTestRecords").withIndex("by_testTagRecordId", (q) => q.eq("testTagRecordId", recordId)).collect());

const base = {
  orgId: ORG, recordId: "rec1", testTagAssetId: "tt1", testDate: NOW,
  testerName: "Alice", now: NOW, actor, auditId: "a1",
};
/** Both enabled Class I readings, passing. */
const goodReadings = {
  earthContinuityResult: "PASS" as const, earthContinuityReading: 0.2,
  insulationResult: "PASS" as const, insulationReading: 200,
};
type CreateArgs = FunctionArgs<typeof api.testTagRecordsWrites.createNative>;
const create = (t: T, args: Record<string, unknown> = {}, identity = asUser) =>
  t.withIdentity(identity).mutation(api.testTagRecordsWrites.createNative, { ...base, ...args } as CreateArgs);
const undo = (t: T, args: Record<string, unknown> = {}, identity = asUser) =>
  t.withIdentity(identity).mutation(api.testTagRecordsWrites.undoCreateNative, { orgId: ORG, recordId: "rec1", auditId: "u1", now: NOW + 1000, actor, ...args });

afterEach(() => { vi.restoreAllMocks(); });

describe("testTagRecordsWrites.createNative", () => {
  test("PASS: record + subtests + asset scalars + status by the DERIVED due date", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await seedProfile(t, { electricalTests: [] });
    const res = await create(t, {
      testProfileId: "prof1", outletCount: 2,
      subTests: [
        { id: "s1", label: "Outlet 1", sortOrder: 0, result: "PASS", earthContinuityResult: "PASS", earthContinuityReading: 0.1 },
        { id: "s2", label: "Outlet 2", sortOrder: 1, result: "PASS" },
      ],
    });
    const due = deriveNextDueDate(NOW, 3);
    expect(res).toEqual({ id: "rec1", nextDueDate: due, result: "PASS" });
    const r = await rec(t, "rec1");
    expect(r?.testedById).toBe(USER);
    expect(r?.result).toBe("PASS");
    expect(r?.nextDueDate).toBe(due);
    expect(r?.visualInspectionResult).toBe("PASS");
    expect(r?.earthContinuityResult).toBe("NOT_APPLICABLE"); // not enabled, not sent
    const subs = await subsOf(t, "rec1");
    expect(subs).toHaveLength(2);
    expect(subs.find((s) => s.id === "s1")?.earthContinuityReading).toBe(0.1);
    const a = await tta(t);
    expect(a?.lastTestDate).toBe(NOW);
    expect(a?.nextDueDate).toBe(due);
    expect(a?.outletCount).toBe(2);
    expect(a?.testProfileId).toBe("prof1"); // set (asset had none)
    expect(a?.status).toBe("CURRENT"); // ~3 months out
    const l = await log(t, "a1");
    expect(l?.action).toBe("CREATE");
    expect(l?.entityType).toBe("testTagRecord");
  });

  test("status: DUE_SOON when the derived date is within the threshold, OVERDUE when past", async () => {
    const t1 = makeT(); await seed(t1); await seedAsset(t1, { testIntervalMonths: 1 });
    await create(t1, { testDate: NOW - 25 * DAY }); // + 1 month ≈ NOW + 5–6 days
    expect((await tta(t1))?.status).toBe("DUE_SOON");

    const t2 = makeT(); await seed(t2); await seedAsset(t2, { testIntervalMonths: 1 });
    await create(t2, { testDate: NOW - 60 * DAY }); // + 1 month ≈ NOW − 29 days
    expect((await tta(t2))?.status).toBe("OVERDUE");
  });

  describe("D52: next due is derived, never typed", () => {
    test("month-end clamp: 31 Jan + 1 month = 29 Feb (leap year)", async () => {
      const t = makeT(); await seed(t); await seedAsset(t, { testIntervalMonths: 1 });
      const jan31 = Date.UTC(2024, 0, 31, 9, 30);
      const res = await create(t, { testDate: jan31 });
      expect(res.nextDueDate).toBe(Date.UTC(2024, 1, 29, 9, 30));
      expect((await tta(t))?.nextDueDate).toBe(Date.UTC(2024, 1, 29, 9, 30));
    });

    test("the interval comes from the asset; an asset without one is on 3 months", async () => {
      const t = makeT(); await seed(t); await seedAsset(t, { testIntervalMonths: undefined });
      const res = await create(t);
      expect(res.nextDueDate).toBe(deriveNextDueDate(NOW, 3));
      expect(new Date(res.nextDueDate).toISOString().slice(0, 10)).toBe("2024-02-14");
    });

    test("the client cannot supply a next-due date (the argument no longer exists)", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      await expect(create(t, { nextDueDate: NOW + 900 * DAY })).rejects.toThrow(/nextDueDate|extra field|Validator/i);
    });

    test("a FAILED test stores the same derived date (\"next due after repair\") and stays FAILED", async () => {
      const t = makeT(); await seed(t); await seedAsset(t, { testIntervalMonths: 6 });
      const res = await create(t, { visualInspectionResult: "FAIL", failureAction: "NONE" });
      expect(res.result).toBe("FAIL");
      expect(res.nextDueDate).toBe(deriveNextDueDate(NOW, 6));
      expect((await rec(t, "rec1"))?.nextDueDate).toBe(deriveNextDueDate(NOW, 6));
      const a = await tta(t);
      expect(a?.nextDueDate).toBe(deriveNextDueDate(NOW, 6));
      expect(a?.status).toBe("FAILED");
    });
  });

  describe("D51 / Q11: readings are checked and the result is derived", () => {
    test("a blank ENABLED reading is rejected", async () => {
      const t = makeT(); await seed(t); await seedAsset(t); await seedProfile(t);
      await expect(create(t, { testProfileId: "prof1", earthContinuityResult: "PASS", earthContinuityReading: 0.2 }))
        .rejects.toThrow(/Enter insulation resistance, or mark it N\/A/);
      expect(await rec(t, "rec1")).toBeNull();
    });

    test("the profile is resolved server-side: omitting testProfileId does not skip the check", async () => {
      const t = makeT(); await seed(t); await seedProfile(t); await seedAsset(t, { testProfileId: "prof1" });
      await expect(create(t, {})).rejects.toThrow(/Enter earth continuity, or mark it N\/A/);
    });

    test("an explicit N/A is accepted (and stored as N/A with no reading)", async () => {
      const t = makeT(); await seed(t); await seedAsset(t); await seedProfile(t);
      const res = await create(t, {
        testProfileId: "prof1", earthContinuityResult: "NOT_APPLICABLE", insulationResult: "PASS", insulationReading: 50,
      });
      expect(res.result).toBe("PASS");
      const r = await rec(t, "rec1");
      expect(r?.earthContinuityResult).toBe("NOT_APPLICABLE");
      expect(r?.earthContinuityReading).toBeUndefined();
      expect(r?.insulationReading).toBe(50);
    });

    test("a reading needs its own verdict; a verdict needs its reading; N/A carries none", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      await expect(create(t, { insulationReading: 5 })).rejects.toThrow(/insulation resistance reading has no pass or fail/);
      await expect(create(t, { insulationResult: "PASS" })).rejects.toThrow(/Enter the insulation resistance reading, or mark it N\/A/);
      await expect(create(t, { insulationResult: "NOT_APPLICABLE", insulationReading: 5 })).rejects.toThrow(/has no pass or fail/);
    });

    test("the profile's threshold decides a verdict: a failing reading cannot be sent as a pass", async () => {
      const t = makeT(); await seed(t); await seedAsset(t); await seedProfile(t);
      await expect(create(t, { testProfileId: "prof1", ...goodReadings, earthContinuityReading: 1.5 }))
        .rejects.toThrow(/earth continuity reading is a fail against the profile's limit/);
    });

    test("the overall result is derived from the verdicts (the client sends none)", async () => {
      const t = makeT(); await seed(t); await seedAsset(t); await seedProfile(t);
      const res = await create(t, { testProfileId: "prof1", ...goodReadings, insulationResult: "FAIL", insulationReading: 0.4, failureAction: "NONE" });
      expect(res.result).toBe("FAIL");
      expect((await rec(t, "rec1"))?.result).toBe("FAIL");
      expect((await rec(t, "rec1"))?.insulationResult).toBe("FAIL"); // its OWN verdict
      expect((await rec(t, "rec1"))?.earthContinuityResult).toBe("PASS"); // not the overall one
    });

    test("a failed visual tick fails the visual inspection, whatever the client claims", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      const res = await create(t, { visualInspectionResult: "PASS", visualCordCondition: false });
      expect(res.result).toBe("FAIL");
      expect((await rec(t, "rec1"))?.visualInspectionResult).toBe("FAIL");
    });

    test("RCD trip current, RCD push-button and microwave leakage are stored, each with its own verdict", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      await seedProfile(t, {
        electricalTests: [
          { key: "rcdTripTime", label: "RCD Trip Time", threshold: 300, operator: "lte", unit: "ms", enabled: true },
          { key: "rcdTripCurrent", label: "RCD Trip Current", threshold: 30, operator: "lte", unit: "mA", enabled: true },
          { key: "rcdPushButton", label: "RCD Push-Button Test", threshold: null, operator: null, unit: "", enabled: true },
          { key: "microwaveLeakage", label: "Microwave", threshold: 5, operator: "lte", unit: "mW/cm²", enabled: true },
        ],
      });
      const res = await create(t, {
        testProfileId: "prof1",
        rcdTripTimeResult: "FAIL", rcdTripTimeReading: 420,
        rcdTripCurrentResult: "PASS", rcdTripCurrentReading: 24,
        rcdPushButtonResult: "PASS",
        microwaveLeakageResult: "NOT_APPLICABLE",
        failureAction: "NONE",
      });
      expect(res.result).toBe("FAIL");
      const r = await rec(t, "rec1");
      expect(r?.rcdTripTimeResult).toBe("FAIL"); // was always PASS (F5)
      expect(r?.rcdTripCurrentResult).toBe("PASS");
      expect(r?.rcdTripCurrentReading).toBe(24);
      expect(r?.rcdPushButtonResult).toBe("PASS");
      expect(r?.microwaveLeakageResult).toBe("NOT_APPLICABLE");
      expect(r?.microwaveLeakageReading).toBeUndefined();
    });

    test("an unset enabled push-button test is a blank, and is rejected", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      await seedProfile(t, { electricalTests: [{ key: "rcdPushButton", label: "RCD Push-Button Test", threshold: null, operator: null, unit: "", enabled: true }] });
      await expect(create(t, { testProfileId: "prof1" })).rejects.toThrow(/Enter RCD push-button, or mark it N\/A/);
    });

    test("sub-tests (outlets): an enabled blank is rejected; a failing outlet fails the record", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      await seedProfile(t, {
        requiresSubTests: true, thresholds: { earthMax: 1 },
        electricalTests: [CLASS_I_TESTS[0]],
      });
      const outlet = (id: string, label: string, reading?: number) => ({
        id, label, sortOrder: 0, ...(reading === undefined ? {} : { earthContinuityResult: reading < 1 ? "PASS" : "FAIL", earthContinuityReading: reading }),
      });
      await expect(create(t, { testProfileId: "prof1", earthContinuityResult: "PASS", earthContinuityReading: 0.2, outletCount: 2, subTests: [outlet("s1", "Outlet 1", 0.2), outlet("s2", "Outlet 2")] }))
        .rejects.toThrow(/Outlet 2: Enter earth continuity, or mark it N\/A/);
      const res = await create(t, {
        testProfileId: "prof1", earthContinuityResult: "PASS", earthContinuityReading: 0.2, failureAction: "NONE", outletCount: 2,
        subTests: [outlet("s1", "Outlet 1", 0.2), outlet("s2", "Outlet 2", 2.5)],
      });
      expect(res.result).toBe("FAIL");
      expect((await subsOf(t, "rec1")).find((s) => s.id === "s2")?.result).toBe("FAIL");
    });

    test("rejects more than 50 sub-tests", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      const subTests = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, label: `O${i}`, sortOrder: i }));
      await expect(create(t, { subTests })).rejects.toThrow(/At most 50 sub-tests/);
    });
  });

  describe("review fixes: the profile is the resolved one, dates and outlets are bounded", () => {
    test("a caller-named LAX profile is rejected (D51 can't be switched off) and never pinned onto the asset", async () => {
      const t = makeT(); await seed(t); await seedAsset(t); await seedProfile(t);
      // A same-org profile with no enabled tests, for some other class.
      await seedProfile(t, { name: "Lax", equipmentClass: "CLASS_II", isDefault: false, electricalTests: [] }, "lax");
      await expect(create(t, { testProfileId: "lax" })).rejects.toThrow(/tested against "Class I", not the profile sent/);
      expect(await rec(t, "rec1")).toBeNull();
      expect((await tta(t))?.testProfileId).toBeUndefined();
    });

    test("an inactive profile is rejected when named, and skipped by the cascade", async () => {
      const t = makeT(); await seed(t); await seedAsset(t, { testProfileId: "old" });
      await seedProfile(t, { name: "Old", isActive: false, isDefault: false }, "old");
      await expect(create(t, { testProfileId: "old" })).rejects.toThrow(/inactive/);
      // Unnamed: the cascade skips the inactive pin, finds no active profile, and holds
      // the test to none — the inactive profile's tests are never what decides it.
      const res = await create(t, {});
      expect(res.result).toBe("PASS");
      expect((await rec(t, "rec1"))?.testProfileId).toBeUndefined();
    });

    test("rejects a test date in the future (5 minutes of skew allowed)", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
      await expect(create(t, { testDate: NOW + 10 * 60 * 1000 })).rejects.toThrow(/can't be in the future/);
      expect((await create(t, { testDate: NOW + 60 * 1000 })).id).toBe("rec1");
      clock.mockRestore();
    });

    test("outlets: a sub-test profile needs at least one, the count must match, and it is bounded", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      await seedProfile(t, { requiresSubTests: true, electricalTests: [] });
      const sub = (id: string) => ({ id, label: id, sortOrder: 0, result: "PASS" as const });
      await expect(create(t, { testProfileId: "prof1" })).rejects.toThrow(/at least one outlet/);
      await expect(create(t, { testProfileId: "prof1", outletCount: 3, subTests: [sub("s1")] })).rejects.toThrow(/must match the outlets tested/);
      await expect(create(t, { testProfileId: "prof1", subTests: [sub("s1")] })).rejects.toThrow(/must match the outlets tested/);
      await expect(create(t, { testProfileId: "prof1", outletCount: 0, subTests: [] })).rejects.toThrow(/whole number from 1 to 50/);
      await expect(create(t, { testProfileId: "prof1", outletCount: 1.5, subTests: [sub("s1")] })).rejects.toThrow(/whole number/);
      expect((await create(t, { testProfileId: "prof1", outletCount: 1, subTests: [sub("s1")] })).result).toBe("PASS");
    });

    test("a sub-test threshold of 0 is a real limit (not 'no threshold')", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      await seedProfile(t, { requiresSubTests: true, thresholds: { leakageMax: 0 }, electricalTests: [] });
      await expect(create(t, {
        testProfileId: "prof1", outletCount: 1,
        subTests: [{ id: "s1", label: "Outlet 1", sortOrder: 0, leakageCurrentResult: "PASS", leakageCurrentReading: 0.4 }],
      })).rejects.toThrow(/Outlet 1: The leakage current reading is a fail/);
    });

    test("a legacy object-shaped electricalTests blob still enforces D51", async () => {
      const t = makeT(); await seed(t); await seedAsset(t);
      await seedProfile(t, { electricalTests: { earthContinuity: true, leakageCurrent: false } });
      await expect(create(t, { testProfileId: "prof1" })).rejects.toThrow(/Enter earth continuity, or mark it N\/A/);
      const t2 = makeT(); await seed(t2); await seedAsset(t2);
      await seedProfile(t2, { electricalTests: "corrupt" });
      await expect(create(t2, { testProfileId: "prof1" })).rejects.toThrow(/can't be read/);
    });

    test("rejects a maintenanceLinkId that already names a link (no foreign link row reused)", async () => {
      const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1" });
      await t.run(async (ctx) => {
        await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true });
        await ctx.db.insert("maintenanceRecordAssets", { id: "lnkX", maintenanceRecordId: "theirM", assetId: "theirA" });
      });
      await expect(create(t, { visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", maintenanceId: "mnt1", maintenanceLinkId: "lnkX" }))
        .rejects.toThrow(/link id already exists/);
    });
  });

  test("FAIL + REMOVED_FROM_SERVICE → FAILED", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await create(t, { visualInspectionResult: "FAIL", failureAction: "REMOVED_FROM_SERVICE" });
    expect((await tta(t))?.status).toBe("FAILED");
  });

  test("FAIL + DISPOSED → RETIRED + isActive false (recalc does not override)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await create(t, { visualInspectionResult: "FAIL", failureAction: "DISPOSED" });
    const a = await tta(t);
    expect(a?.status).toBe("RETIRED");
    expect(a?.isActive).toBe(false);
  });

  test("a failure action is ignored on a derived PASS (the client can't fail a passing test into an action)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await create(t, { failureAction: "DISPOSED" });
    expect((await tta(t))?.status).toBe("CURRENT");
    expect((await rec(t, "rec1"))?.failureAction).toBe("NONE");
  });

  test("FAIL + REFERRED_TO_ELECTRICIAN creates maintenance + link + asset IN_MAINTENANCE", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1" });
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true }); });
    await create(t, {
      visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", failureNotes: "Burnt cord",
      maintenanceId: "mnt1", maintenanceLinkId: "lnk1",
    });
    const m = await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "mnt1")).first());
    expect(m?.type).toBe("REPAIR");
    expect(m?.status).toBe("SCHEDULED");
    expect(m?.reportedById).toBe(USER);
    const links = await t.run(async (ctx) => ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", "mnt1")).collect());
    expect(links.map((l) => l.assetId)).toEqual(["as1"]);
    expect((await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "as1")).first()))?.status).toBe("IN_MAINTENANCE");
    expect((await tta(t))?.status).toBe("FAILED");
  });

  test("FAIL + REFERRED_TO_ELECTRICIAN on a RETIRED inventory asset leaves it RETIRED (the referral is still recorded)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1" });
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "RETIRED", isActive: false }); });
    await create(t, {
      visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", failureNotes: "Burnt cord",
      maintenanceId: "mnt1", maintenanceLinkId: "lnk1",
    });
    expect((await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "as1")).first()))).toMatchObject({ status: "RETIRED", isActive: false });
    expect(await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "mnt1")).first())).not.toBeNull();
  });

  test("rejects a non-member testedById", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await expect(create(t, { testedById: "user_ghost" })).rejects.toThrow(/not a member/i);
  });

  test("org mismatch: rejects a cross-org asset and a cross-org profile", async () => {
    const t = makeT(); await seed(t);
    await seedAsset(t, { organizationId: OTHER });
    await expect(create(t)).rejects.toThrow(/not found/i);

    const t2 = makeT(); await seed(t2); await seedAsset(t2);
    await seedProfile(t2, {}, "profX", OTHER);
    await expect(create(t2, { testProfileId: "profX" })).rejects.toThrow(/Test profile not found/);
  });

  test("actor is pinned to the token: spoofed userId ignored, name from mirror", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await create(t, { actor: { userId: "user_evil", userName: "Hacker" } });
    expect((await rec(t, "rec1"))?.testedById).toBe(USER);
    const l = await log(t, "a1");
    expect(l?.userId).toBe(USER);
    expect(l?.userName).toBe("Alice");
  });

  test("viewer is denied", async () => {
    const t = makeT(); await seed(t, "viewer"); await seedAsset(t);
    await expect(create(t, {}, { subject: USER, orgId: ORG, role: "viewer" })).rejects.toThrow(/Forbidden|permission/i);
  });

  test("rejects out-of-bounds fields (R-8.6.2 server-side mirror of testTagRecordSchema/subTestRecordSchema)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await expect(create(t, { testerName: "x".repeat(201) })).rejects.toThrow(/Tester name/i);
    await expect(create(t, { failureNotes: "x".repeat(2001) })).rejects.toThrow(/Failure notes/i);
    await expect(create(t, { subTests: [{ id: "s1", label: "x".repeat(101), sortOrder: 0 }] })).rejects.toThrow(/Sub-test label/i);
  });

  test("rejects a maintenanceId that already exists in ANOTHER org (no cross-tenant link injection)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1" });
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("maintenanceRecords", { id: "mForeign", organizationId: OTHER, type: "REPAIR", status: "SCHEDULED", title: "x", createdAt: NOW, updatedAt: NOW });
    });
    await expect(create(t, { visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", maintenanceId: "mForeign", maintenanceLinkId: "lnk1" })).rejects.toThrow();
    const links = await t.run(async (ctx) => ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", "mForeign")).collect());
    expect(links).toHaveLength(0);
  });

  test("rejects a sub-test id that collides with a DIFFERENT record's sub-test", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await t.run(async (ctx) => { await ctx.db.insert("subTestRecords", { id: "sX", testTagRecordId: "otherRec", label: "L", sortOrder: 0 }); });
    await expect(create(t, { subTests: [{ id: "sX", label: "Mine", sortOrder: 0, result: "PASS" }] })).rejects.toThrow();
  });
});

describe("testTagRecordsWrites.undoCreateNative (exact undo)", () => {
  test("restores every field exactly — including ones that were ABSENT — and leaves an UNDO trace", async () => {
    const t = makeT(); await seed(t); await seedAsset(t); await seedProfile(t, { electricalTests: [] });
    const before = await tta(t);
    await create(t, { testProfileId: "prof1", outletCount: 1, subTests: [{ id: "s1", label: "Outlet 1", sortOrder: 0 }] });
    expect((await tta(t))?.status).toBe("CURRENT");

    expect(await undo(t)).toEqual({ ok: true });
    expect(await rec(t, "rec1")).toBeNull();
    expect(await subsOf(t, "rec1")).toHaveLength(0);
    const after = await tta(t);
    const pick = (a: typeof before) => ({
      lastTestDate: a?.lastTestDate, nextDueDate: a?.nextDueDate, outletCount: a?.outletCount,
      testProfileId: a?.testProfileId, status: a?.status, isActive: a?.isActive, updatedAt: a?.updatedAt,
    });
    expect(pick(after)).toEqual(pick(before));
    expect(after?.lastTestDate).toBeUndefined(); // was absent → unset, not null/0
    expect(after?.testProfileId).toBeUndefined();
    expect((await log(t, "a1"))?.action).toBe("CREATE"); // audit rows are append-only
    const u = await log(t, "u1");
    expect(u?.action).toBe("UNDO");
    expect(u?.details).toMatchObject({ undoOf: "a1" });
  });

  test("a failed referral: deletes the referral + link and restores the inventory asset", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1", status: "CURRENT", lastTestDate: NOW - 90 * DAY, nextDueDate: NOW + DAY });
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true, updatedAt: NOW - 5 * DAY }); });
    await create(t, { visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", maintenanceId: "mnt1", maintenanceLinkId: "lnk1" });
    await undo(t);
    expect(await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "mnt1")).first())).toBeNull();
    expect(await t.run(async (ctx) => ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", "lnk1")).first())).toBeNull();
    const inv = await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "as1")).first());
    expect(inv?.status).toBe("AVAILABLE");
    expect(inv?.updatedAt).toBe(NOW - 5 * DAY);
    const a = await tta(t);
    expect(a?.status).toBe("CURRENT");
    expect(a?.lastTestDate).toBe(NOW - 90 * DAY);
    expect(a?.nextDueDate).toBe(NOW + DAY);
  });

  test("a referral onto an EXISTING record: undo deletes only the link it added, by (record, asset), never a same-id foreign row", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1" });
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("maintenanceRecords", { id: "mOld", organizationId: ORG, type: "REPAIR", status: "SCHEDULED", title: "x", createdAt: NOW - DAY, updatedAt: NOW - DAY });
    });
    await create(t, { visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", maintenanceId: "mOld", maintenanceLinkId: "lnk1" });
    // A foreign row that shares the link id (by_cuid is global; links have no org column).
    await t.run(async (ctx) => { await ctx.db.insert("maintenanceRecordAssets", { id: "lnk1", maintenanceRecordId: "theirM", assetId: "theirA" }); });
    await undo(t);
    const rows = await t.run(async (ctx) => ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", "lnk1")).collect());
    expect(rows.map((r) => r.maintenanceRecordId)).toEqual(["theirM"]);
    expect(await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "mOld")).first())).not.toBeNull();
  });

  // Review SF6: one test per guard, each failing without its guard.
  describe("each failure-action guard refuses on its own", () => {
    const linkRows = (t: T) => t.run(async (ctx) => ctx.db.query("maintenanceRecordAssets").collect());
    async function seedInventory(t: T) {
      await seed(t); await seedAsset(t, { assetId: "as1" });
      await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true, updatedAt: NOW - DAY }); });
    }
    async function referOntoExisting(t: T) {
      await seedInventory(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("maintenanceRecords", { id: "mOld", organizationId: ORG, type: "REPAIR", status: "SCHEDULED", title: "x", createdAt: NOW - DAY, updatedAt: NOW - DAY });
      });
      await create(t, { visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", maintenanceId: "mOld", maintenanceLinkId: "lnk1" });
    }

    test("the linked inventory asset's snapshot: a status change since refuses", async () => {
      const t = makeT(); await seedInventory(t);
      await create(t, { visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", maintenanceId: "mnt1", maintenanceLinkId: "lnk1" });
      await t.run(async (ctx) => {
        const inv = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "as1")).first();
        await ctx.db.patch(inv!._id, { status: "AVAILABLE" }); // someone put it back in service; same updatedAt
      });
      await expect(undo(t)).rejects.toThrow(/linked asset changed since/);
      expect(await rec(t, "rec1")).not.toBeNull();
      expect(await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "mnt1")).first())).not.toBeNull();
    });

    test("deleteAddedLink: a referral record now in another org refuses, and its link is kept", async () => {
      const t = makeT(); await referOntoExisting(t);
      await t.run(async (ctx) => {
        const m = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "mOld")).first();
        await ctx.db.patch(m!._id, { organizationId: OTHER });
      });
      await expect(undo(t)).rejects.toThrow(/referral can't be found/);
      expect((await linkRows(t)).map((l) => l.id)).toEqual(["lnk1"]);
      expect(await rec(t, "rec1")).not.toBeNull();
    });

    test("deleteAddedLink: only the link row THIS save inserted is deleted (a re-made link under that pair survives)", async () => {
      const t = makeT(); await referOntoExisting(t);
      // Someone removed the save's link and linked the same asset again themselves.
      await t.run(async (ctx) => {
        const l = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", "lnk1")).first();
        await ctx.db.delete(l!._id);
        await ctx.db.insert("maintenanceRecordAssets", { id: "lnkTheirs", maintenanceRecordId: "mOld", assetId: "as1" });
      });
      expect(await undo(t)).toEqual({ ok: true });
      expect((await linkRows(t)).map((l) => l.id)).toEqual(["lnkTheirs"]);
    });
  });

  test("refuses when the item was tested again since", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await create(t);
    await create(t, { recordId: "rec2", auditId: "a2", now: NOW + 5 });
    await expect(undo(t)).rejects.toThrow(/tested again since/);
    expect(await rec(t, "rec1")).not.toBeNull();
  });

  test("refuses when the item changed since (and changes nothing)", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await create(t);
    await t.run(async (ctx) => {
      const a = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "tt1")).first();
      await ctx.db.patch(a!._id, { testIntervalMonths: 12, updatedAt: NOW + 50 });
    });
    await expect(undo(t)).rejects.toThrow(/changed since/);
    expect(await rec(t, "rec1")).not.toBeNull();
  });

  test("refuses when the referral has been worked on since", async () => {
    const t = makeT(); await seed(t); await seedAsset(t, { assetId: "as1" });
    await t.run(async (ctx) => { await ctx.db.insert("assets", { id: "as1", organizationId: ORG, assetTag: "PA-1", modelId: "m", status: "AVAILABLE", isActive: true }); });
    await create(t, { visualInspectionResult: "FAIL", failureAction: "REFERRED_TO_ELECTRICIAN", maintenanceId: "mnt1", maintenanceLinkId: "lnk1" });
    await t.run(async (ctx) => {
      const m = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", "mnt1")).first();
      await ctx.db.patch(m!._id, { status: "IN_PROGRESS", updatedAt: NOW + 60 });
    });
    await expect(undo(t)).rejects.toThrow(/worked on since/);
    expect(await rec(t, "rec1")).not.toBeNull();
  });

  test("refuses a second undo, another user's save, and a legacy record with no snapshot", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: USER2, role: "admin" });
      await ctx.db.insert("users", { id: USER2, name: "Bob", email: "b@x.com" });
    });
    await create(t);
    await expect(undo(t, { actor: { userId: USER2, userName: "Bob" } }, { subject: USER2, orgId: ORG, role: "admin" }))
      .rejects.toThrow(/Only the person who saved this test can undo it/);
    await undo(t);
    // The UNDO-row guard itself answers (it runs before the deleted record is looked up).
    await expect(undo(t, { auditId: "u2" })).rejects.toThrow(/already undone/);

    await t.run(async (ctx) => {
      await ctx.db.insert("testTagRecords", { id: "old1", organizationId: ORG, testTagAssetId: "tt1", testDate: NOW, testedById: USER, testerName: "Al", result: "PASS", nextDueDate: NOW });
    });
    await expect(undo(t, { recordId: "old1", auditId: "u3" })).rejects.toThrow(/can't be undone/);
  });

  test("the 10-minute window is measured on the SERVER clock", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
    await create(t);
    clock.mockReturnValue(NOW + 11 * 60 * 1000);
    // The caller's own `now` says "1 second later" — ignored.
    await expect(undo(t, { now: NOW + 1000 })).rejects.toThrow(/within 10 minutes/);
    clock.mockReturnValue(NOW + 9 * 60 * 1000);
    expect(await undo(t)).toEqual({ ok: true });
  });

  test("org mismatch: a caller in another org cannot undo this org's record", async () => {
    const t = makeT(); await seed(t); await seedAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m3", organizationId: OTHER, userId: USER2, role: "admin" });
      await ctx.db.insert("users", { id: USER2, name: "Bob", email: "b@x.com" });
    });
    await create(t);
    const outsider = { subject: USER2, orgId: OTHER, role: "admin" };
    await expect(undo(t, { orgId: OTHER, actor: { userId: USER2, userName: "Bob" } }, outsider)).rejects.toThrow(/can't be undone/);
    await expect(undo(t, { actor: { userId: USER2, userName: "Bob" } }, outsider)).rejects.toThrow();
    expect(await rec(t, "rec1")).not.toBeNull();
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
    expect(latest?.testedBy.name).toBe("Alice");

    const page = await t.withIdentity(asUser).query(api.testTagRecords.recordsPage, { orgId: ORG, testTagAssetId: "tt1", page: 1, pageSize: 1 });
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.records).toHaveLength(1);
    expect(page.records[0].id).toBe("r2");
    const page2 = await t.withIdentity(asUser).query(api.testTagRecords.recordsPage, { orgId: ORG, testTagAssetId: "tt1", page: 2, pageSize: 1 });
    expect(page2.records[0].testProfile?.name).toBe("Standard");
    expect(page2.records[0].subTestRecords).toHaveLength(1);
  });
});
