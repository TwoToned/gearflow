// @vitest-environment node
//
// convex/maintenanceScheduleGeneration.ts — the daily WS6 #945 PM-cycle generator.
// Covers: the dormant ENABLE_CONVEX_CRONS gate, cron idempotency (double-run
// generates nothing new), merge semantics (single open cycle per schedule, no
// stacking), pool-quantity snapshotting for both SERIALIZED and BULK models,
// and — the load-bearing one — the NON-BLOCKING INVARIANT: a full
// generate -> check-off -> complete cycle must never touch asset.status,
// bulkAsset.availableQuantity, or computeStockBreakdown's output.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import schema from "./schema";
import { internal, api } from "./_generated/api";
import { computeStockBreakdown } from "./lib/availabilityCore";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = Date.UTC(2026, 0, 15); // caller-supplied `now` arg for mutations (distinct from the faked wall clock)
// Faked wall clock the generation mutation's own `Date.now()` reads — sits
// between the Jan-1 anchor and the next Jul-1 due date in most tests below, so
// "now" is deterministic and independent of the real system clock/timezone.
const FAKE_NOW = Date.UTC(2026, 2, 1);
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "warehouse" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedOrg(t: T, role = "warehouse") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
  });
}

async function seedSerializedModel(t: T, modelId: string, unitCount: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", {
      id: modelId, organizationId: ORG, name: "Moving Light", assetType: "SERIALIZED",
    });
    for (let i = 0; i < unitCount; i++) {
      await ctx.db.insert("assets", {
        id: `${modelId}-a${i}`, organizationId: ORG, assetTag: `MOV-${i}`, modelId,
        status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW,
      });
    }
  });
}

async function seedBulkModel(t: T, modelId: string, bulkAssetId: string, totalQuantity: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", {
      id: modelId, organizationId: ORG, name: "XLR Cable 10m", assetType: "BULK",
    });
    await ctx.db.insert("bulkAssets", {
      id: bulkAssetId, organizationId: ORG, modelId, assetTag: "XLR-10M",
      totalQuantity, availableQuantity: totalQuantity, isActive: true, createdAt: NOW, updatedAt: NOW,
    });
  });
}

async function seedSchedule(
  t: T,
  id: string,
  modelId: string,
  intervalMonths: number,
  anchorDate: number,
  overrides: Partial<{ isActive: boolean }> = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("serviceSchedules", {
      id, organizationId: ORG, modelId, name: "6-month service", intervalMonths, anchorDate,
      isActive: overrides.isActive ?? true, createdAt: NOW, updatedAt: NOW,
    });
  });
}

const cyclesFor = (t: T, scheduleId: string) =>
  t.run(async (ctx) =>
    ctx.db.query("maintenanceRecords").withIndex("by_serviceScheduleId", (q) => q.eq("serviceScheduleId", scheduleId)).collect(),
  );
const allAssets = (t: T) => t.run(async (ctx) => ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
const allBulk = (t: T) => t.run(async (ctx) => ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());

const ENV_KEYS = ["ENABLE_CONVEX_CRONS"] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  vi.useFakeTimers({ toFake: ["Date"], now: FAKE_NOW });
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.useRealTimers();
});

describe("generateDueCycles — dormant gate", () => {
  test("no-ops (skipped) when ENABLE_CONVEX_CRONS is unset", async () => {
    const t = makeT(); await seedOrg(t); await seedSerializedModel(t, "modelA", 3);
    await seedSchedule(t, "sched1", "modelA", 6, Date.UTC(2026, 0, 1));
    const res = await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    expect(res.skipped).toBe(true);
    expect(await cyclesFor(t, "sched1")).toHaveLength(0);
  });
});

describe("generateDueCycles — enabled", () => {
  beforeEach(() => { process.env.ENABLE_CONVEX_CRONS = "true"; });

  test("does nothing before the anchor date", async () => {
    const t = makeT(); await seedOrg(t); await seedSerializedModel(t, "modelA", 3);
    await seedSchedule(t, "sched1", "modelA", 6, Date.UTC(2027, 0, 1)); // anchor in the future
    const res = await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    expect(res.created).toBe(0);
    expect(await cyclesFor(t, "sched1")).toHaveLength(0);
  });

  test("skips an inactive schedule", async () => {
    const t = makeT(); await seedOrg(t); await seedSerializedModel(t, "modelA", 3);
    await seedSchedule(t, "sched1", "modelA", 6, Date.UTC(2026, 0, 1), { isActive: false });
    const res = await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    expect(res.created).toBe(0);
  });

  test("generates a SCHEDULED/PREVENTATIVE cycle with the serialized pool snapshot frozen", async () => {
    const t = makeT(); await seedOrg(t); await seedSerializedModel(t, "modelA", 5);
    await seedSchedule(t, "sched1", "modelA", 6, Date.UTC(2026, 0, 1));
    const res = await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    expect(res.created).toBe(1);
    const cycles = await cyclesFor(t, "sched1");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].type).toBe("PREVENTATIVE");
    expect(cycles[0].status).toBe("SCHEDULED");
    expect(cycles[0].poolQuantitySnapshot).toBe(5);
    expect(cycles[0].scheduledDate).toBe(Date.UTC(2026, 0, 1));
  });

  test("generates with the BULK pool snapshot = summed active totalQuantity", async () => {
    const t = makeT(); await seedOrg(t); await seedBulkModel(t, "modelB", "bulk1", 120);
    await seedSchedule(t, "sched1", "modelB", 6, Date.UTC(2026, 0, 1));
    await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    const cycles = await cyclesFor(t, "sched1");
    expect(cycles[0].poolQuantitySnapshot).toBe(120);
  });

  test("idempotent — a same-day double-run generates nothing new", async () => {
    const t = makeT(); await seedOrg(t); await seedSerializedModel(t, "modelA", 3);
    await seedSchedule(t, "sched1", "modelA", 6, Date.UTC(2026, 0, 1));
    const first = await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    expect(first.created).toBe(1);
    const second = await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    expect(second.created).toBe(0);
    expect(second.noop).toBe(1);
    expect(await cyclesFor(t, "sched1")).toHaveLength(1); // still exactly one row
  });

  test("merge semantics: an incomplete open cycle rolls forward instead of stacking a second row", async () => {
    const t = makeT(); await seedOrg(t); await seedSerializedModel(t, "modelA", 3);
    // Monthly cadence so a later `now` crosses multiple cycle boundaries.
    await seedSchedule(t, "sched1", "modelA", 1, Date.UTC(2026, 0, 1));
    await t.run(async (ctx) => {
      // Directly seed an OPEN cycle at the FIRST due date (as if generated long ago
      // and never completed).
      await ctx.db.insert("maintenanceRecords", {
        id: "rec_old", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED",
        title: "old cycle", scheduledDate: Date.UTC(2026, 0, 1), serviceScheduleId: "sched1",
        poolQuantitySnapshot: 3, createdAt: NOW, updatedAt: NOW,
      });
    });
    // "Now" is 3 months later — several cycles have passed while it stayed open.
    vi.setSystemTime(Date.UTC(2026, 3, 15));
    const res = await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    expect(res.merged).toBe(1);
    expect(res.created).toBe(0);
    const cycles = await cyclesFor(t, "sched1");
    expect(cycles).toHaveLength(1); // no stacking — the SAME row, rolled forward
    expect(cycles[0].id).toBe("rec_old");
    expect(cycles[0].scheduledDate).toBe(Date.UTC(2026, 3, 1));
    expect(cycles[0].poolQuantitySnapshot).toBe(3); // untouched by the merge
  });

  test("a new cycle generates once the previous one is COMPLETED", async () => {
    const t = makeT(); await seedOrg(t); await seedSerializedModel(t, "modelA", 2);
    await seedSchedule(t, "sched1", "modelA", 1, Date.UTC(2026, 0, 1));
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", {
        id: "rec_done", organizationId: ORG, type: "PREVENTATIVE", status: "COMPLETED", result: "PASS",
        title: "done", scheduledDate: Date.UTC(2026, 0, 1), serviceScheduleId: "sched1",
        poolQuantitySnapshot: 2, createdAt: NOW, updatedAt: NOW,
      });
    });
    vi.setSystemTime(Date.UTC(2026, 1, 1));
    const res = await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    expect(res.created).toBe(1);
    const cycles = await cyclesFor(t, "sched1");
    expect(cycles).toHaveLength(2);
  });
});

describe("WS6 non-blocking invariant — full generate -> check-off -> complete cycle", () => {
  beforeEach(() => { process.env.ENABLE_CONVEX_CRONS = "true"; });

  test("SERIALIZED: computeStockBreakdown is byte-identical before and after a full PM cycle", async () => {
    const t = makeT(); await seedOrg(t); await seedSerializedModel(t, "modelA", 3);
    await seedSchedule(t, "sched1", "modelA", 6, Date.UTC(2026, 0, 1));

    const before = computeStockBreakdown({
      assetType: "SERIALIZED",
      assets: (await allAssets(t)).map((a) => ({ status: a.status ?? "AVAILABLE" })),
      bulkAssets: [],
    });

    await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    const [cycle] = await cyclesFor(t, "sched1");
    expect(cycle.status).toBe("SCHEDULED"); // never holds

    // Check off every unit one at a time.
    for (let i = 0; i < 3; i++) {
      await t.withIdentity(asUser).mutation(api.maintenanceCheckoffWrites.checkOffUnit, {
        orgId: ORG, recordId: cycle.id, assetId: `modelA-a${i}`, checkoffId: `co${i}`,
        now: NOW, actor, auditId: `aud${i}`,
      });
    }

    const after = computeStockBreakdown({
      assetType: "SERIALIZED",
      assets: (await allAssets(t)).map((a) => ({ status: a.status ?? "AVAILABLE" })),
      bulkAssets: [],
    });
    expect(after).toEqual(before); // BYTE-IDENTICAL — the whole point of this test

    // Every individual asset is untouched, and the cycle auto-completed.
    for (const a of await allAssets(t)) expect(a.status).toBe("AVAILABLE");
    const completed = await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", cycle.id)).unique());
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.result).toBe("PASS");
  });

  test("BULK: session check-offs (incl. 'check all remaining') never touch availableQuantity", async () => {
    const t = makeT(); await seedOrg(t); await seedBulkModel(t, "modelB", "bulk1", 120);
    await seedSchedule(t, "sched1", "modelB", 6, Date.UTC(2026, 0, 1));

    const beforeQty = (await allBulk(t))[0].availableQuantity;

    await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    const [cycle] = await cyclesFor(t, "sched1");

    await t.withIdentity(asUser).mutation(api.maintenanceCheckoffWrites.checkOffBulkSession, {
      orgId: ORG, recordId: cycle.id, bulkAssetId: "bulk1", sessionId: "sess1",
      quantity: 18, now: NOW, actor, auditId: "auda",
    });
    // Progress mid-cycle: still open, quantity untouched.
    expect((await allBulk(t))[0].availableQuantity).toBe(beforeQty);
    const mid = await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", cycle.id)).unique());
    expect(mid?.status).toBe("SCHEDULED");

    // "Check all remaining" (102 left of 120).
    const finalRes = await t.withIdentity(asUser).mutation(api.maintenanceCheckoffWrites.checkOffBulkSession, {
      orgId: ORG, recordId: cycle.id, bulkAssetId: "bulk1", sessionId: "sess2",
      checkAllRemaining: true, now: NOW, actor, auditId: "audb",
    });
    expect(finalRes.quantityRecorded).toBe(102);
    expect(finalRes.completed).toBe(true);
    expect((await allBulk(t))[0].availableQuantity).toBe(beforeQty); // STILL untouched

    const completed = await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", cycle.id)).unique());
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.result).toBe("PASS");
  });

  test("snapshot stability: resizing the pool mid-cycle does not change the frozen denominator", async () => {
    const t = makeT(); await seedOrg(t); await seedBulkModel(t, "modelB", "bulk1", 100);
    await seedSchedule(t, "sched1", "modelB", 6, Date.UTC(2026, 0, 1));
    await t.mutation(internal.maintenanceScheduleGeneration.generateDueCycles, {});
    const [cycle] = await cyclesFor(t, "sched1");
    expect(cycle.poolQuantitySnapshot).toBe(100);

    // Resize the pool (fleet grows) mid-cycle.
    await t.run(async (ctx) => {
      const b = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "bulk1")).unique();
      await ctx.db.patch(b!._id, { totalQuantity: 200 });
    });

    // Checking off the ORIGINAL 100 still completes the cycle — the snapshot
    // didn't silently grow to 200.
    const res = await t.withIdentity(asUser).mutation(api.maintenanceCheckoffWrites.checkOffBulkSession, {
      orgId: ORG, recordId: cycle.id, bulkAssetId: "bulk1", sessionId: "sessAll",
      checkAllRemaining: true, now: NOW, actor, auditId: "aud1",
    });
    expect(res.quantityRecorded).toBe(100);
    expect(res.completed).toBe(true);
    const record = await t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", cycle.id)).unique());
    expect(record?.poolQuantitySnapshot).toBe(100); // frozen, never recomputed
  });
});
