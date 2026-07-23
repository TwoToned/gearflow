// @vitest-environment node
//
// convex/checkRecordWrites.ts — the browser-direct CHECK-RECORD state machine
// (completeCheckAndDeprep / Pack / Flag / Store + saveAdHocCheck / saveKitLevelChecks
// / saveChildItemChecks). Verifies the atomic fold: check-record insert + line/unit
// state transition + inline predictive maintenance, plus the security bar
// (blocking-comment gate, cross-tenant, viewer RBAC, actor pinning).
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

async function seed(t: T, role = "admin") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", createdAt: NOW, updatedAt: NOW });
  });
}

async function seedCheckItem(t: T, id = "ci1", label = "Visual", org = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("checkItems", { id, organizationId: org, label, type: "PASS_FAIL", createdAt: NOW, updatedAt: NOW });
  });
}
async function seedAsset(t: T, id: string, status = "AVAILABLE", extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("assets", {
      id, organizationId: ORG, assetTag: id.toUpperCase(), modelId: "m1",
      status: status as "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW, ...extra,
    });
  });
}
async function seedLine(t: T, id: string, patch: Record<string, unknown> = {}, org = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectLineItems", {
      id, organizationId: org, projectId: "p1", type: "EQUIPMENT",
      quantity: 1, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW, ...patch,
    });
  });
}

const records = (t: T) => t.run(async (ctx) => ctx.db.query("checkRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
const line = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const unitsOf = (t: T, lineItemId: string) => t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId)).collect());
const asset = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const maint = (t: T) => t.run(async (ctx) => ctx.db.query("maintenanceRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());
const maintLinks = (t: T) => t.run(async (ctx) => ctx.db.query("maintenanceRecordAssets").collect());

const mkCheck = (opts: Partial<{ recordId: string; checkItemId: string; result: "PASS" | "FAIL" | "NOTES_ONLY" }> = {}) => ({
  recordId: opts.recordId ?? "r1",
  checkItemId: opts.checkItemId ?? "ci1",
  result: opts.result ?? ("PASS" as const),
});
const pmEntry = (checkItemId = "ci1") => ({ checkItemId, maintenanceId: "mnt1", maintenanceLinkId: "mlnk1", auditId: "ma1" });

// ─── completeCheckAndPack ──────────────────────────────────────────────────────
describe("completeCheckAndPack", () => {
  test("packs the unit (PACKED + rollup) and inserts a PREP check record", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    await seedLine(t, "L1", { assetId: "as1", prepStatus: "PENDING" });
    const res = await t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndPack, {
      orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1",
      checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW, actor,
    });
    expect(res.success).toBe(true);
    const us = await unitsOf(t, "L1");
    expect(us).toHaveLength(1);
    expect(us[0].prepStatus).toBe("PACKED");
    expect((await line(t, "L1"))?.prepStatus).toBe("PACKED");
    const recs = await records(t);
    expect(recs).toHaveLength(1);
    expect(recs[0].context).toBe("PREP");
    expect(recs[0].checkItemLabelSnapshot).toBe("Visual");
  });

  test("blocking-comment gate blocks the pack", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    await seedLine(t, "L1", { assetId: "as1", prepStatus: "PENDING" });
    await t.run(async (ctx) => {
      await ctx.db.insert("commentThreads", {
        orgId: ORG, projectId: "p1", entityType: "project", entityId: "p1",
        status: "open", isBlocking: true, createdBy: USER, createdByName: "Alice", createdAt: NOW, updatedAt: NOW,
      });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndPack, {
        orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1",
        checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow(/blocking comment/i);
    // Atomic rollback — no record written.
    expect(await records(t)).toHaveLength(0);
  });

  test("rejects a cross-org line", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t);
    await seedLine(t, "Lx", { prepStatus: "PENDING" }, OTHER);
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndPack, {
        orgId: ORG, projectId: "p1", lineItemId: "Lx", checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("rejects a check record id owned by another org (cross-tenant)", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    await seedLine(t, "L1", { assetId: "as1", prepStatus: "PENDING" });
    await t.run(async (ctx) => {
      await ctx.db.insert("checkRecords", {
        id: "r1", organizationId: OTHER, context: "AD_HOC", checkItemId: "ci1",
        checkItemLabelSnapshot: "x", checkItemTypeSnapshot: "PASS_FAIL", result: "PASS", performedById: "u2", performedAt: NOW,
      });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndPack, {
        orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1",
        checks: [mkCheck({ recordId: "r1" })], maintenancePlan: [], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow(/collision/i);
  });

  test("actor is pinned to the token subject (spoofed userId ignored)", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    await seedLine(t, "L1", { assetId: "as1", prepStatus: "PENDING" });
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndPack, {
      orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1",
      checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW,
      actor: { userId: "attacker", userName: "Mallory" },
    });
    expect((await records(t))[0].performedById).toBe(USER);
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.userId).toBe(USER);
  });
});

// ─── completeCheckAndFlag ──────────────────────────────────────────────────────
describe("completeCheckAndFlag", () => {
  test("sets prepStatus = FLAGGED_FAULTY + inserts a PREP record", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    await seedLine(t, "L1", { assetId: "as1", prepStatus: "PENDING" });
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndFlag, {
      orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1", flagType: "FLAGGED_FAULTY",
      checks: [mkCheck({ result: "FAIL" })], maintenancePlan: [pmEntry()], auditId: "a1", now: NOW, actor,
    });
    expect((await line(t, "L1"))?.prepStatus).toBe("FLAGGED_FAULTY");
    expect(await records(t)).toHaveLength(1);
  });
});

// ─── completeCheckAndDeprep ────────────────────────────────────────────────────
describe("completeCheckAndDeprep", () => {
  test("resets a RETURNED line to PENDING + cascades the accessory child", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t);
    await seedAsset(t, "as1"); await seedAsset(t, "acc1", "AVAILABLE", { parentAssetId: "as1" });
    await seedLine(t, "L1", { assetId: "as1", status: "RETURNED", prepStatus: "PACKED" });
    await seedLine(t, "C1", { assetId: "acc1", parentLineItemId: "L1", isKitChild: true, childKind: "ACCESSORY", status: "CONFIRMED", prepStatus: "PACKED" });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "cu1", organizationId: ORG, lineItemId: "C1", ordinal: 1, assetId: "acc1",
        parentUnitAssetId: "as1", quantity: 1, returnedQuantity: 0, status: "CONFIRMED", prepStatus: "PACKED", createdAt: NOW, updatedAt: NOW,
      });
    });
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndDeprep, {
      orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1", checks: [mkCheck()], auditId: "a1", now: NOW, actor,
    });
    expect((await line(t, "L1"))?.prepStatus).toBe("PENDING");
    expect((await line(t, "C1"))?.prepStatus).toBe("PENDING");
    expect((await unitsOf(t, "C1"))[0].prepStatus).toBe("PENDING");
    const recs = await records(t);
    expect(recs[0].context).toBe("RETURN");
  });

  test("rejects when the line is not RETURNED (state guard)", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    await seedLine(t, "L1", { assetId: "as1", status: "CONFIRMED", prepStatus: "PACKED" });
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndDeprep, {
        orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1", checks: [mkCheck()], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow(/RETURNED/i);
  });
});

// ─── completeCheckAndStore ─────────────────────────────────────────────────────
describe("completeCheckAndStore", () => {
  test("returns the unit via checkin (RETURNED + asset AVAILABLE) + RETURN record", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1", "CHECKED_OUT");
    await seedLine(t, "L1", { assetId: "as1", status: "CHECKED_OUT" });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "L1", ordinal: 1, assetId: "as1",
        quantity: 1, returnedQuantity: 0, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW,
      });
    });
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndStore, {
      orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1", condition: "GOOD",
      checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW, actor,
    });
    expect((await unitsOf(t, "L1"))[0].status).toBe("RETURNED");
    expect((await asset(t, "as1"))?.status).toBe("AVAILABLE");
    expect((await records(t))[0].context).toBe("RETURN");
  });

  test("rejects when the line's FALLBACK asset belongs to another org (resolved-asset guard)", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t);
    // A foreign-org asset referenced by a line in OUR org; checkinItemsCore would flip its
    // status via the line fallback. No a.assetId → resolvedAssetId = the foreign line.assetId.
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "foreignAs", organizationId: "org_other", assetTag: "FA", modelId: "m1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await seedLine(t, "L1", { assetId: "foreignAs", status: "CHECKED_OUT" });
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndStore, {
        orgId: ORG, projectId: "p1", lineItemId: "L1", condition: "GOOD",
        checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow();
  });

  // R-8.6.2 — mirrors completeCheckAndStoreSchema's `notes` bound (check-item.ts);
  // this hook never calls checkRecordSchema/completeCheckAndStoreSchema.parse(), so
  // this is the ONLY enforcement point, not a redundant mirror.
  test("rejects a top-level notes over the 2000-char bound", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1", "CHECKED_OUT");
    await seedLine(t, "L1", { assetId: "as1", status: "CHECKED_OUT" });
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.completeCheckAndStore, {
        orgId: ORG, projectId: "p1", lineItemId: "L1", assetId: "as1", condition: "GOOD",
        notes: "X".repeat(2001), checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow(/notes/);
  });
});

// ─── R-8.6.2 — checkRecordSchema.notes bound (checks[].notes) ────────────────────
// Enforced once, inside insertCheckRecords, so it covers every mutation that submits
// `checks` — verified here via saveAdHocCheck (the simplest caller).
describe("checkRecordSchema.notes bound (per-check notes)", () => {
  test("rejects a per-check notes over the 2000-char bound", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.saveAdHocCheck, {
        orgId: ORG, assetId: "as1",
        checks: [{ ...mkCheck(), notes: "X".repeat(2001) }],
        maintenancePlan: [], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow(/notes/);
  });
});

// ─── saveAdHocCheck ────────────────────────────────────────────────────────────
describe("saveAdHocCheck", () => {
  test("inserts an AD_HOC record with no line + no transition", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.saveAdHocCheck, {
      orgId: ORG, assetId: "as1", checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW, actor,
    });
    const recs = await records(t);
    expect(recs).toHaveLength(1);
    expect(recs[0].context).toBe("AD_HOC");
    expect(recs[0].assetId).toBe("as1");
    expect(recs[0].lineItemId).toBeUndefined();
  });

  test("viewer is denied (warehouse:scan)", async () => {
    const t = makeT(); await seed(t, "viewer"); await seedCheckItem(t); await seedAsset(t, "as1");
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.checkRecordWrites.saveAdHocCheck, {
        orgId: ORG, assetId: "as1", checks: [mkCheck()], maintenancePlan: [], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow(/Forbidden|permission/i);
  });
});

// ─── saveKitLevelChecks ────────────────────────────────────────────────────────
describe("saveKitLevelChecks", () => {
  test("carries kitId + lineItemId; no transition; no predictive maintenance", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t);
    await seedLine(t, "KL1", { kitId: "k1", prepStatus: "PENDING" });
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.saveKitLevelChecks, {
      orgId: ORG, projectId: "p1", kitId: "k1", lineItemId: "KL1", context: "PREP",
      checks: [mkCheck({ result: "FAIL" })], now: NOW, actor,
    });
    const recs = await records(t);
    expect(recs).toHaveLength(1);
    expect(recs[0].kitId).toBe("k1");
    expect(recs[0].lineItemId).toBe("KL1");
    expect(recs[0].context).toBe("PREP");
    // kit-level never runs predictive maintenance, even on a FAIL.
    expect(await maint(t)).toHaveLength(0);
  });
});

// ─── predictive maintenance (via saveAdHocCheck) ───────────────────────────────
describe("predictive maintenance", () => {
  async function seedPriorFails(t: T) {
    await t.run(async (ctx) => {
      // Two prior records for (as1, ci1): one FAIL, one PASS.
      await ctx.db.insert("checkRecords", { id: "p1r", organizationId: ORG, context: "AD_HOC", assetId: "as1", checkItemId: "ci1", checkItemLabelSnapshot: "Visual", checkItemTypeSnapshot: "PASS_FAIL", result: "FAIL", performedById: USER, performedAt: NOW - 2000 });
      await ctx.db.insert("checkRecords", { id: "p2r", organizationId: ORG, context: "AD_HOC", assetId: "as1", checkItemId: "ci1", checkItemLabelSnapshot: "Visual", checkItemTypeSnapshot: "PASS_FAIL", result: "PASS", performedById: USER, performedAt: NOW - 1000 });
    });
  }

  test("fires on 2-of-3 FAILs: SCHEDULED/PREVENTATIVE record + link, asset NOT held", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1"); await seedPriorFails(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW }); });
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.saveAdHocCheck, {
      orgId: ORG, assetId: "as1",
      checks: [mkCheck({ recordId: "newr", result: "FAIL" })], maintenancePlan: [pmEntry()], auditId: "a1", now: NOW, actor,
    });
    const ms = await maint(t);
    expect(ms).toHaveLength(1);
    expect(ms[0].type).toBe("PREVENTATIVE");
    expect(ms[0].status).toBe("SCHEDULED");
    expect(ms[0].title).toContain("[Auto] Visual");
    const links = await maintLinks(t);
    expect(links.map((l) => l.assetId)).toContain("as1");
    // PREVENTATIVE/SCHEDULED does NOT hold the asset.
    expect((await asset(t, "as1"))?.status).toBe("AVAILABLE");
  });

  test("dedups: an existing active auto record blocks a second create", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1"); await seedPriorFails(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "existing", organizationId: ORG, type: "PREVENTATIVE", status: "SCHEDULED", title: "[Auto] Visual — AS1", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("maintenanceRecordAssets", { id: "elink", maintenanceRecordId: "existing", assetId: "as1" });
    });
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.saveAdHocCheck, {
      orgId: ORG, assetId: "as1",
      checks: [mkCheck({ recordId: "newr", result: "FAIL" })], maintenancePlan: [pmEntry()], auditId: "a1", now: NOW, actor,
    });
    // Still just the one pre-existing record — no duplicate.
    expect(await maint(t)).toHaveLength(1);
  });

  test("does not fire below the 2-fail threshold", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1");
    // Only the current FAIL (no priors) → failCount 1 → no maintenance.
    await t.withIdentity(asUser).mutation(api.checkRecordWrites.saveAdHocCheck, {
      orgId: ORG, assetId: "as1",
      checks: [mkCheck({ recordId: "newr", result: "FAIL" })], maintenancePlan: [pmEntry()], auditId: "a1", now: NOW, actor,
    });
    expect(await maint(t)).toHaveLength(0);
  });

  test("rejects a FAIL check whose failed item has NO maintenance-plan entry (PM can't be silently skipped)", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1"); await seedPriorFails(t);
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.saveAdHocCheck, {
        orgId: ORG, assetId: "as1",
        checks: [mkCheck({ recordId: "newr", result: "FAIL" })], maintenancePlan: [], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow();
  });

  test("rejects a plan maintenanceId that collides with an UNRELATED same-org record", async () => {
    const t = makeT(); await seed(t); await seedCheckItem(t); await seedAsset(t, "as1"); await seedPriorFails(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW });
      // An unrelated same-org record already holding the plan's maintenanceId "mnt1".
      await ctx.db.insert("maintenanceRecords", { id: "mnt1", organizationId: ORG, type: "REPAIR", status: "SCHEDULED", title: "Unrelated", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.checkRecordWrites.saveAdHocCheck, {
        orgId: ORG, assetId: "as1",
        checks: [mkCheck({ recordId: "newr", result: "FAIL" })], maintenancePlan: [pmEntry()], auditId: "a1", now: NOW, actor,
      }),
    ).rejects.toThrow();
  });
});
