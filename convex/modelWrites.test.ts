// @vitest-environment node
//
// convex/modelWrites.ts + convex/models.ts (detail). Verifies CRUD + audit, the
// archive asset/bulk cascade, bulkUpdateRates math + per-row org re-check, T&T
// backfill on create/update + T&T-default propagation, cross-tenant rejection,
// RBAC (model:*), and the detail composite (assets/bulk/media/accessories).
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
  await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role }); });
}
const model = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const base = { id: "mdl1", orgId: ORG, name: "SM58", now: NOW, actor, auditId: "a1" } as const;

describe("modelWrites", () => {
  test("create → update → sets fields + audit", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.modelWrites.createNative, { ...base, manufacturer: "Shure", dailyRate: 10 });
    const c = await model(t, "mdl1");
    expect(c?.name).toBe("SM58");
    expect(c?.dailyRate).toBe(10);
    expect(c?.defaultRentalPrice).toBe(10); // dailyRate syncs defaultRentalPrice
    const log = await t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
    expect(log?.action).toBe("CREATE");

    await t.withIdentity(asUser).mutation(api.modelWrites.updateNative, { ...base, name: "SM58-LC", now: NOW + 1, auditId: "a2" });
    expect((await model(t, "mdl1"))?.name).toBe("SM58-LC");
  });

  test("dup id rejected", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.modelWrites.createNative, base);
    await expect(t.withIdentity(asUser).mutation(api.modelWrites.createNative, { ...base, auditId: "a2" })).rejects.toThrow(/already exists/i);
  });

  test("validation: blank name + negative rate rejected", async () => {
    const t = makeT(); await seedMember(t);
    await expect(t.withIdentity(asUser).mutation(api.modelWrites.createNative, { ...base, name: "" })).rejects.toThrow(/name is required/i);
    await expect(t.withIdentity(asUser).mutation(api.modelWrites.createNative, { ...base, name: "X", dailyRate: -5 })).rejects.toThrow(/positive/i);
  });

  test("archive deletes assets + bulk (org-filtered) then soft-archives", async () => {
    const t = makeT(); await seedMember(t);
    await t.withIdentity(asUser).mutation(api.modelWrites.createNative, base);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A", modelId: "mdl1", isActive: true });
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, assetTag: "B", modelId: "mdl1", isActive: true });
      await ctx.db.insert("assets", { id: "aX", organizationId: OTHER, assetTag: "Z", modelId: "mdl1", isActive: true }); // foreign
    });
    await t.withIdentity(asUser).mutation(api.modelWrites.archiveNative, { id: "mdl1", orgId: ORG, now: NOW + 5, actor, auditId: "a3" });
    expect((await model(t, "mdl1"))?.isActive).toBe(false);
    const assets = await t.run(async (ctx) => ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", "mdl1")).collect());
    expect(assets.map((a) => a.id)).toEqual(["aX"]); // own-org deleted, foreign untouched
    const bulk = await t.run(async (ctx) => ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", "mdl1")).collect());
    expect(bulk).toHaveLength(0);
  });

  test("bulkUpdateRates: set/multiply/percent, dailyRate syncs, org re-check", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "A", dailyRate: 10, weeklyRate: 50 });
      await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "B", dailyRate: 20 });
      await ctx.db.insert("models", { id: "mX", organizationId: OTHER, name: "Foreign", dailyRate: 1 });
    });
    // multiply dailyRate ×2, include a foreign id that must be skipped
    const res = await t.withIdentity(asUser).mutation(api.modelWrites.bulkUpdateRatesNative, {
      orgId: ORG, modelIds: ["m1", "m2", "mX"], rateType: "dailyRate", operation: "multiply", value: 2, now: NOW, actor, auditId: "a1",
    });
    expect(res.count).toBe(2); // foreign skipped
    const m1 = await model(t, "m1");
    expect(m1?.dailyRate).toBe(20);
    expect(m1?.defaultRentalPrice).toBe(20); // synced
    expect((await model(t, "mX"))?.dailyRate).toBe(1); // untouched
    // increase_percent 10% on weeklyRate
    await t.withIdentity(asUser).mutation(api.modelWrites.bulkUpdateRatesNative, {
      orgId: ORG, modelIds: ["m1"], rateType: "weeklyRate", operation: "increase_percent", value: 10, now: NOW, actor, auditId: "a2",
    });
    expect((await model(t, "m1"))?.weeklyRate).toBe(55);
  });

  test("bulkUpdateRates rejects negative set / non-positive multiplier", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "A" }); });
    await expect(t.withIdentity(asUser).mutation(api.modelWrites.bulkUpdateRatesNative, { orgId: ORG, modelIds: ["m1"], rateType: "dailyRate", operation: "set", value: -1, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/negative/i);
    await expect(t.withIdentity(asUser).mutation(api.modelWrites.bulkUpdateRatesNative, { orgId: ORG, modelIds: ["m1"], rateType: "dailyRate", operation: "multiply", value: 0, now: NOW, actor, auditId: "a2" })).rejects.toThrow(/positive/i);
  });

  test("T&T backfill on create auto-registers T&T for existing assets of the model", async () => {
    const t = makeT(); await seedMember(t);
    // Asset already exists referencing the model id the client is about to create.
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "PA-100", modelId: "mdl1", serialNumber: "SN1", isActive: true });
    });
    await t.withIdentity(asUser).mutation(api.modelWrites.createNative, { ...base, requiresTestAndTag: true, testAndTagIntervalDays: 90, defaultEquipmentClass: "CLASS_II" });
    const tt = await t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", "a1")).collect());
    expect(tt).toHaveLength(1);
    expect(tt[0].testTagId).toBe("PA-100");
    expect(tt[0].equipmentClass).toBe("CLASS_II");
    expect(tt[0].testIntervalMonths).toBe(3); // round(90/30)
  });

  test("T&T propagation on update pushes defaults to active T&T rows", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "PA", requiresTestAndTag: true });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "T1", modelId: "mdl1", isActive: true });
      await ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, assetId: "a1", testTagId: "T1", description: "d", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", isActive: true });
    });
    await t.withIdentity(asUser).mutation(api.modelWrites.updateNative, { ...base, requiresTestAndTag: true, defaultEquipmentClass: "CLASS_II", defaultApplianceType: "POWER_BOARD", testAndTagIntervalDays: 180 });
    const tt = await t.run(async (ctx) => ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "tt1")).first());
    expect(tt?.equipmentClass).toBe("CLASS_II");
    expect(tt?.applianceType).toBe("POWER_BOARD");
    expect(tt?.testIntervalMonths).toBe(6); // round(180/30)
  });

  test("cross-tenant update rejected; RBAC rejects a viewer", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mX", organizationId: OTHER, name: "Foreign" }); });
    await expect(t.withIdentity(asUser).mutation(api.modelWrites.updateNative, { id: "mX", orgId: ORG, name: "hijack", now: NOW, actor, auditId: "a1" })).rejects.toThrow(/not found/i);
    await t.run(async (ctx) => { const m = await ctx.db.query("members").withIndex("by_cuid", (q) => q.eq("id", "m1")).first(); if (m) await ctx.db.patch(m._id, { role: "viewer" }); });
    await expect(t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.modelWrites.createNative, base)).rejects.toThrow(/Forbidden|permission/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing modelSchema.parse() in the
  // browser hook) must still hit the same business-constraint bounds server-side.
  describe("field bounds (R-8.6.2)", () => {
    test("rejects a description over the 2000-char bound on create", async () => {
      const t = makeT(); await seedMember(t);
      await expect(
        t.withIdentity(asUser).mutation(api.modelWrites.createNative, { ...base, description: "d".repeat(2001) }),
      ).rejects.toThrow(/description/i);
    });

    test("rejects a manufacturer over the 200-char bound on the update patch", async () => {
      const t = makeT(); await seedMember(t);
      await t.withIdentity(asUser).mutation(api.modelWrites.createNative, base);
      await expect(
        t.withIdentity(asUser).mutation(api.modelWrites.updateNative, { ...base, manufacturer: "m".repeat(201), now: NOW + 1, auditId: "a2" }),
      ).rejects.toThrow(/manufacturer/i);
    });

    test("rejects a non-integer powerDraw on create", async () => {
      const t = makeT(); await seedMember(t);
      await expect(
        t.withIdentity(asUser).mutation(api.modelWrites.createNative, { ...base, powerDraw: 12.5 }),
      ).rejects.toThrow(/powerDraw/);
    });

    test("rejects a non-integer testAndTagIntervalDays on create", async () => {
      const t = makeT(); await seedMember(t);
      await expect(
        t.withIdentity(asUser).mutation(api.modelWrites.createNative, { ...base, requiresTestAndTag: true, testAndTagIntervalDays: 90.5 }),
      ).rejects.toThrow(/testAndTagIntervalDays/);
    });

    test("rejects a non-integer maintenanceIntervalDays on the update patch", async () => {
      const t = makeT(); await seedMember(t);
      await t.withIdentity(asUser).mutation(api.modelWrites.createNative, base);
      await expect(
        t.withIdentity(asUser).mutation(api.modelWrites.updateNative, { ...base, maintenanceIntervalDays: 5.5, now: NOW + 1, auditId: "a2" }),
      ).rejects.toThrow(/maintenanceIntervalDays/);
    });
  });

  // Sales Stock tab's manual restock action — a thin wrapper over
  // saleStock.ts's adjustModelSaleStock shared primitive (R-3.1).
  describe("adjustSaleStockNative", () => {
    test("positive delta restocks; negative delta corrects down; writes an audit log", async () => {
      const t = makeT(); await seedMember(t);
      await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "SM58", saleStockQuantity: 5 }); });

      const res1 = await t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockNative, {
        id: "mdl1", orgId: ORG, delta: 20, reason: "Received PO #1", now: NOW, actor, auditId: "a1",
      });
      expect(res1.saleStockQuantity).toBe(25);
      expect((await model(t, "mdl1"))?.saleStockQuantity).toBe(25);

      const res2 = await t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockNative, {
        id: "mdl1", orgId: ORG, delta: -3, now: NOW + 1, actor, auditId: "a2",
      });
      expect(res2.saleStockQuantity).toBe(22);

      const logs = await t.run(async (ctx) => (await ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect()).filter((l) => l.entityId === "mdl1"));
      const restockLog = logs.find((l) => l.summary.includes("Added 20"));
      expect(restockLog?.summary).toContain("Received PO #1");
      expect(logs.find((l) => l.summary.includes("Removed 3"))).toBeTruthy();
    });

    test("allows an oversell-style negative pool (no floor)", async () => {
      const t = makeT(); await seedMember(t);
      await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "SM58", saleStockQuantity: 2 }); });
      const res = await t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockNative, {
        id: "mdl1", orgId: ORG, delta: -5, now: NOW, actor, auditId: "a1",
      });
      expect(res.saleStockQuantity).toBe(-3);
    });

    test("defaults an unset pool to 0 before applying the delta", async () => {
      const t = makeT(); await seedMember(t);
      await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "SM58" }); });
      const res = await t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockNative, {
        id: "mdl1", orgId: ORG, delta: 10, now: NOW, actor, auditId: "a1",
      });
      expect(res.saleStockQuantity).toBe(10);
    });

    test("rejects a zero or non-integer delta", async () => {
      const t = makeT(); await seedMember(t);
      await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "SM58" }); });
      await expect(t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockNative, { id: "mdl1", orgId: ORG, delta: 0, now: NOW, actor, auditId: "a1" })).rejects.toThrow(/nonzero/i);
      await expect(t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockNative, { id: "mdl1", orgId: ORG, delta: 1.5, now: NOW, actor, auditId: "a2" })).rejects.toThrow(/whole number/i);
    });

    test("rejects a reason over the 500-char bound", async () => {
      const t = makeT(); await seedMember(t);
      await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "SM58" }); });
      await expect(
        t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockNative, { id: "mdl1", orgId: ORG, delta: 1, reason: "x".repeat(501), now: NOW, actor, auditId: "a1" }),
      ).rejects.toThrow(/reason/i);
    });

    test("cross-tenant target rejected", async () => {
      const t = makeT(); await seedMember(t);
      await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mX", organizationId: OTHER, name: "Foreign" }); });
      await expect(
        t.withIdentity(asUser).mutation(api.modelWrites.adjustSaleStockNative, { id: "mX", orgId: ORG, delta: 5, now: NOW, actor, auditId: "a1" }),
      ).rejects.toThrow(/not found/i);
    });

    test("RBAC: a viewer cannot restock", async () => {
      const t = makeT(); await seedMember(t, "viewer");
      await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "SM58" }); });
      await expect(
        t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(api.modelWrites.adjustSaleStockNative, { id: "mdl1", orgId: ORG, delta: 5, now: NOW, actor, auditId: "a1" }),
      ).rejects.toThrow(/Forbidden|permission/i);
    });
  });
});

describe("models.detail", () => {
  test("returns model + category + active assets/bulk (tag asc) + media + accessories, org-checked", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Mixer", categoryId: "cat1" });
      await ctx.db.insert("categories", { id: "cat1", organizationId: ORG, name: "Audio" });
      await ctx.db.insert("assets", { id: "a2", organizationId: ORG, assetTag: "B", modelId: "mdl1", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, assetTag: "A", modelId: "mdl1", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("assets", { id: "aInactive", organizationId: ORG, assetTag: "C", modelId: "mdl1", isActive: false }); // excluded
      await ctx.db.insert("assets", { id: "aX", organizationId: OTHER, assetTag: "Z", modelId: "mdl1", isActive: true }); // foreign excluded
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, assetTag: "BK", modelId: "mdl1", totalQuantity: 5, availableQuantity: 5, isActive: true });
      await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "p.jpg", fileSize: 1, mimeType: "image/jpeg", storageKey: "k", url: "http://x/p.jpg", uploadedById: USER, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("modelMedia", { id: "mm1", organizationId: ORG, modelId: "mdl1", fileId: "f1", type: "PHOTO", isPrimary: true, sortOrder: 0 });
      await ctx.db.insert("bulkAssets", { id: "acc-bulk", organizationId: ORG, assetTag: "ACC", modelId: "accModel" });
      await ctx.db.insert("models", { id: "accModel", organizationId: ORG, name: "Cable" });
      await ctx.db.insert("modelBulkAccessories", { id: "mba1", organizationId: ORG, modelId: "mdl1", bulkAssetId: "acc-bulk", quantity: 2, addedById: USER });
    });
    const res = await t.withIdentity(asUser).query(api.models.detail, { id: "mdl1" });
    expect(res).not.toBeNull();
    expect(res!.name).toBe("Mixer");
    expect(res!.category?.name).toBe("Audio");
    expect(res!.assets.map((a) => a.id)).toEqual(["a1", "a2"]); // active, tag asc, foreign+inactive excluded
    expect(res!.bulkAssets).toHaveLength(1);
    expect(res!.media).toHaveLength(1);
    expect(res!.media[0].file.url).toBe("http://x/p.jpg");
    expect(res!.bulkAccessories[0].bulkAsset.model?.name).toBe("Cable");
  });

  test("detail returns null for a missing model", async () => {
    const t = makeT(); await seedMember(t);
    expect(await t.withIdentity(asUser).query(api.models.detail, { id: "nope" })).toBeNull();
  });

  test("detail rejects a caller from another org", async () => {
    const t = makeT(); await seedMember(t);
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "mX", organizationId: OTHER, name: "Foreign" }); });
    await expect(t.withIdentity(asUser).query(api.models.detail, { id: "mX" })).rejects.toThrow();
  });
});
