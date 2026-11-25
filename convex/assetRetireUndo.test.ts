// @vitest-environment node
// UX Phase 12 — Retire with an exact Undo, Reinstate, and the Delete history gate (D32/D33).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;
const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const ME = { userId: "u1", userName: "Alice" };
const BOB = { userId: "u2", userName: "Bob" };

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, assetId: "a1", testTagId: "T-1", description: "T-1", status: "NOT_YET_TESTED", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}
const asset = (t: T) => t.run((ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first());
const tt = (t: T) => t.run((ctx) => ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "tt1")).first());
const retire = (t: T, auditId = "r1", actor = ME) =>
  t.withIdentity(SERVICE).mutation(api.assetWrites.archiveNative, { id: "a1", orgId: ORG, actor, auditId, now: NOW });
const undo = (t: T, auditId = "r1", actor = ME, orgId = ORG) =>
  t.withIdentity(SERVICE).mutation(api.assetWrites.undoRetireNative, { id: "a1", orgId, auditId, actor, now: NOW });

describe("Retire + exact Undo", () => {
  test("Undo restores the asset and the T&T row exactly, once", async () => {
    const t = makeT();
    await seed(t);
    expect((await retire(t)).undoable).toBe(true);
    expect((await asset(t))?.status).toBe("RETIRED");
    expect((await tt(t))?.status).toBe("RETIRED");

    await undo(t);
    expect(await asset(t)).toMatchObject({ status: "AVAILABLE", isActive: true });
    expect(await tt(t)).toMatchObject({ status: "NOT_YET_TESTED", isActive: true });
    await expect(undo(t)).rejects.toThrow(/already undone/);
  });

  test("a retire that changes nothing is not undoable", async () => {
    const t = makeT();
    await seed(t);
    await retire(t, "r1");
    expect((await retire(t, "r2")).undoable).toBe(false);
    await expect(undo(t, "r2")).rejects.toThrow(/can't be undone/);
  });

  test("refuses when the asset moved on since, writing nothing", async () => {
    const t = makeT();
    await seed(t);
    await retire(t);
    await t.run(async (ctx) => {
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      await ctx.db.patch(a!._id, { status: "LOST" });
    });
    await expect(undo(t)).rejects.toThrow(/status changed since/);
    expect((await asset(t))?.status).toBe("LOST");
    expect((await tt(t))?.status).toBe("RETIRED");
  });

  test("refuses when the T&T row changed since, writing nothing", async () => {
    const t = makeT();
    await seed(t);
    await retire(t);
    await t.run(async (ctx) => {
      const r = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "tt1")).first();
      await ctx.db.patch(r!._id, { isActive: true });
    });
    await expect(undo(t)).rejects.toThrow(/test & tag record changed since/);
    expect((await asset(t))?.status).toBe("RETIRED");
  });

  test("only the author, only this org", async () => {
    const t = makeT();
    await seed(t);
    await retire(t);
    await expect(undo(t, "r1", BOB)).rejects.toThrow(/Only the person/);
    await expect(undo(t, "r1", ME, OTHER)).rejects.toThrow();
    expect((await asset(t))?.status).toBe("RETIRED");
  });

  test("Reinstate brings it back without reviving T&T, and has its own Undo", async () => {
    const t = makeT();
    await seed(t);
    await retire(t);
    const r = await t.withIdentity(SERVICE).mutation(api.assetWrites.reinstateNative, { id: "a1", orgId: ORG, actor: ME, auditId: "i1", now: NOW });
    expect(r.undoable).toBe(true);
    expect(await asset(t)).toMatchObject({ status: "AVAILABLE", isActive: true });
    expect((await tt(t))?.status).toBe("RETIRED");
    await undo(t, "i1");
    expect(await asset(t)).toMatchObject({ status: "RETIRED", isActive: false });
  });
});

describe("Edit with an exact Undo (updateNative / undoUpdateNative)", () => {
  const edit = (t: T, set: Record<string, unknown>, clear: string[] = [], auditId = "e1") =>
    t.withIdentity(SERVICE).mutation(api.assetWrites.updateNative, { id: "a1", orgId: ORG, set, clear, actor: ME, auditId, now: NOW });
  const undoEdit = (t: T, auditId = "e1", actor = ME) =>
    t.withIdentity(SERVICE).mutation(api.assetWrites.undoUpdateNative, { id: "a1", orgId: ORG, auditId, actor, now: NOW });

  test("restores exactly what the edit changed (a set field, a cleared field), once", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      await ctx.db.patch(a!._id, { customName: "FOH desk", serialNumber: "S1" });
    });
    expect((await edit(t, { serialNumber: "S2", condition: "FAIR" }, ["customName"])).undoable).toBe(true);
    expect(await asset(t)).toMatchObject({ serialNumber: "S2", condition: "FAIR" });
    expect((await asset(t))?.customName).toBeUndefined();

    await undoEdit(t);
    expect(await asset(t)).toMatchObject({ serialNumber: "S1", condition: "GOOD", customName: "FOH desk" });
    await expect(undoEdit(t)).rejects.toThrow(/already undone/);
  });

  test("an edit that changes nothing is not undoable; a later edit of the same field blocks the Undo", async () => {
    const t = makeT();
    await seed(t);
    expect((await edit(t, { condition: "GOOD" })).undoable).toBe(false);
    await edit(t, { condition: "FAIR" }, [], "e2");
    await edit(t, { condition: "POOR" }, [], "e3");
    await expect(undoEdit(t, "e2")).rejects.toThrow(/condition changed since/);
    expect((await asset(t))?.condition).toBe("POOR");
    await expect(undoEdit(t, "e3", BOB)).rejects.toThrow(/Only the person/);
    await undoEdit(t, "e3");
    expect((await asset(t))?.condition).toBe("FAIR");
  });

  test("an Undo that would restore a tag now used by another asset is refused, writing nothing", async () => {
    const t = makeT();
    await seed(t);
    await edit(t, { assetTag: "TAG-NEW" });
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a9", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(undoEdit(t)).rejects.toThrow(/used by another asset/);
    expect((await asset(t))?.assetTag).toBe("TAG-NEW");
  });
});

describe("Reinstate is only the way back from RETIRED", () => {
  const reinstate = (t: T) => t.withIdentity(SERVICE).mutation(api.assetWrites.reinstateNative, { id: "a1", orgId: ORG, actor: ME, auditId: "i1", now: NOW });
  const setStatus = (t: T, status: string) =>
    t.run(async (ctx) => {
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      await ctx.db.patch(a!._id, { status: status as never });
    });

  test.each(["CHECKED_OUT", "IN_MAINTENANCE", "LOST", "AVAILABLE", "RESERVED", "SOLD"])("an asset that is %s is refused and unchanged", async (status) => {
    const t = makeT();
    await seed(t);
    await setStatus(t, status);
    await expect(reinstate(t)).rejects.toThrow(/not retired/);
    expect((await asset(t))?.status).toBe(status);
  });

  test.each(["ACTIVE", "LOW_STOCK", "OUT_OF_STOCK"])("a bulk row that is %s is refused", async (status) => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BK-1", totalQuantity: 5, availableQuantity: 5, status: status as never, isActive: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(SERVICE).mutation(api.bulkAssetsWrites.reinstateNative, { id: "b1", orgId: ORG, actor: ME, auditId: "i1", now: NOW }),
    ).rejects.toThrow(/not retired/);
    const row = await t.run((ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "b1")).first());
    expect(row?.status).toBe(status);
  });
});

describe("Delete history gate", () => {
  const del = (t: T) => t.withIdentity(SERVICE).mutation(api.assetWrites.deleteNative, { id: "a1", orgId: ORG, actor: ME, auditId: "d1", now: NOW });

  test("a bare asset (even a retired, audited, T&T-registered one) deletes", async () => {
    const t = makeT();
    await seed(t);
    await retire(t);
    await del(t);
    expect(await asset(t)).toBeNull();
  });

  test("maintenance, a test, a check and a scan each block it", async () => {
    const cases: Record<string, (t: T) => Promise<void>> = {
      maintenance: (t) =>
        t.run(async (ctx) => {
          await ctx.db.insert("maintenanceRecords", { id: "mr1", organizationId: ORG, type: "REPAIR", title: "Fix" } as never);
          await ctx.db.insert("maintenanceRecordAssets", { id: "mra1", maintenanceRecordId: "mr1", assetId: "a1" });
        }),
      test: (t) =>
        t.run(async (ctx) => {
          const r = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", "tt1")).first();
          await ctx.db.patch(r!._id, { lastTestDate: NOW });
        }),
      scan: (t) =>
        t.run(async (ctx) => {
          await ctx.db.insert("assetScanLogs", { id: "s1", organizationId: ORG, assetId: "a1", action: "CHECK_OUT", scannedById: "u1" });
        }),
    };
    for (const [name, make] of Object.entries(cases)) {
      const t = makeT();
      await seed(t);
      await make(t);
      await expect(del(t), name).rejects.toThrow(/can't be deleted because/);
      expect(await asset(t)).not.toBeNull();
    }
  });

  test("another org's maintenance link does not count as this asset's history", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("maintenanceRecords", { id: "mrX", organizationId: OTHER, type: "REPAIR", title: "Other" } as never);
      await ctx.db.insert("maintenanceRecordAssets", { id: "mraX", maintenanceRecordId: "mrX", assetId: "a1" });
    });
    await del(t);
    expect(await asset(t)).toBeNull();
  });
});

describe("Bulk stock: Retire Undo and the same gate", () => {
  async function seedBulk(t: T) {
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BK-1", totalQuantity: 5, availableQuantity: 5, status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW });
    });
  }
  const bulk = (t: T) => t.run((ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "b1")).first());

  test("retire then Undo restores the row", async () => {
    const t = makeT();
    await seedBulk(t);
    await t.withIdentity(SERVICE).mutation(api.bulkAssetsWrites.archiveNative, { id: "b1", orgId: ORG, actor: ME, auditId: "br1", now: NOW });
    expect(await bulk(t)).toMatchObject({ status: "RETIRED", isActive: false });
    await t.withIdentity(SERVICE).mutation(api.bulkAssetsWrites.undoRetireNative, { id: "b1", orgId: ORG, auditId: "br1", actor: ME, now: NOW });
    expect(await bulk(t)).toMatchObject({ status: "ACTIVE", isActive: true });
  });

  test("a scan log blocks Delete", async () => {
    const t = makeT();
    await seedBulk(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assetScanLogs", { id: "s1", organizationId: ORG, bulkAssetId: "b1", action: "CHECK_OUT", scannedById: "u1" });
    });
    await expect(
      t.withIdentity(SERVICE).mutation(api.bulkAssetsWrites.deleteNative, { id: "b1", orgId: ORG, actor: ME, auditId: "d1", now: NOW }),
    ).rejects.toThrow(/can't be deleted because/);
  });
});
