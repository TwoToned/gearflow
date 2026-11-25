// @vitest-environment node
// UX Phase 12 slice-2 review: the survivors. Edits can't move an asset into or out of
// RETIRED (Retire / Reinstate are the only paths), a patch that sets one warranty date is
// checked against the stored other, bulk Reinstate derives its status from stock, bulk
// Delete is blocked by every history reason, and the exact edit Undo is bound to its own
// entity, its own org's marker, and the caller's permission.
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
const DAY = 86_400_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const ME = { userId: "u1", userName: "Alice" };

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "TAG-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a2", organizationId: ORG, modelId: "m1", assetTag: "TAG-2", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}
const update = (t: T, set: Record<string, unknown>, auditId = "e1", clear: string[] = []) =>
  t.withIdentity(SERVICE).mutation(api.assetWrites.updateNative, { id: "a1", orgId: ORG, set: set as never, clear, actor: ME, auditId, now: NOW });
const getAsset = (t: T, id = "a1") => t.run((ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("an edit cannot move an asset into or out of RETIRED", () => {
  test("status into RETIRED, status out of RETIRED and an isActive change are refused; restating the stored values is fine", async () => {
    const t = makeT();
    await seed(t);
    await expect(update(t, { status: "RETIRED" })).rejects.toThrow(/Retire or Reinstate/);
    await expect(update(t, { isActive: false })).rejects.toThrow(/Retire or Reinstate/);
    expect((await getAsset(t))).toMatchObject({ status: "AVAILABLE", isActive: true });
    await update(t, { status: "AVAILABLE", isActive: true, notes: "ok" }, "e2"); // restating is not a move

    await t.withIdentity(SERVICE).mutation(api.assetWrites.archiveNative, { id: "a1", orgId: ORG, actor: ME, auditId: "r1", now: NOW });
    await expect(update(t, { status: "AVAILABLE" }, "e3")).rejects.toThrow(/Retire or Reinstate/);
    await expect(update(t, { isActive: true }, "e4")).rejects.toThrow(/Retire or Reinstate/);
    expect(await getAsset(t)).toMatchObject({ status: "RETIRED", isActive: false });
    await update(t, { status: "RETIRED", isActive: false, notes: "still retired" }, "e5"); // an edit of a retired unit may restate it
  });

  test("a bulk edit is held to the same rule", async () => {
    const t = makeT();
    await t.run((ctx) => ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BK-1", totalQuantity: 5, availableQuantity: 5, status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW }));
    await expect(
      t.withIdentity(SERVICE).mutation(api.bulkAssetsWrites.updateNative, { id: "b1", orgId: ORG, modelId: "m1", assetTag: "BK-1", totalQuantity: 5, status: "RETIRED", actor: ME, auditId: "u1", now: NOW } as never),
    ).rejects.toThrow(/Retire or Reinstate/);
  });
});

describe("warranty against the stored date", () => {
  test("a patch that sets only the warranty is checked against the stored purchase date, and only the purchase date against the stored warranty", async () => {
    const t = makeT();
    await seed(t);
    await update(t, { purchaseDate: NOW, warrantyExpiry: NOW + 30 * DAY }, "w0");
    await expect(update(t, { warrantyExpiry: NOW - DAY }, "w1")).rejects.toThrow(/Warranty can't end before/);
    await expect(update(t, { purchaseDate: NOW + 60 * DAY }, "w2")).rejects.toThrow(/Warranty can't end before/);
    await update(t, { warrantyExpiry: NOW + 90 * DAY }, "w3");
    // clearing the stored purchase date removes the constraint
    await update(t, { warrantyExpiry: NOW - 5 * DAY }, "w4", ["purchaseDate"]);
  });
});

describe("bulk Reinstate derives its status from stock", () => {
  test.each([
    [0, "OUT_OF_STOCK"],
    [7, "ACTIVE"],
  ])("a retired row with %i units comes back %s", async (qty, expected) => {
    const t = makeT();
    await t.run((ctx) => ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BK-1", totalQuantity: qty, availableQuantity: qty, status: "RETIRED", isActive: false, createdAt: NOW, updatedAt: NOW }));
    await t.withIdentity(SERVICE).mutation(api.bulkAssetsWrites.reinstateNative, { id: "b1", orgId: ORG, actor: ME, auditId: "i1", now: NOW });
    const row = await t.run((ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "b1")).first());
    expect(row).toMatchObject({ status: expected, isActive: true });
  });
});

describe("bulk Delete history gate: every reason blocks, a bare row deletes", () => {
  const del = (t: T) => t.withIdentity(SERVICE).mutation(api.bulkAssetsWrites.deleteNative, { id: "b1", orgId: ORG, actor: ME, auditId: "d1", now: NOW });
  const bulk = (t: T) => t.run((ctx) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "b1")).first());
  const seedBulk = (t: T) => t.run((ctx) => ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "BK-1", totalQuantity: 5, availableQuantity: 5, status: "ACTIVE", isActive: true, createdAt: NOW, updatedAt: NOW }));

  const reasons: Record<string, (t: T) => Promise<unknown>> = {
    MAINTENANCE: (t) =>
      t.run(async (ctx) => {
        await ctx.db.insert("maintenanceRecords", { id: "mr1", organizationId: ORG, type: "REPAIR", title: "Fix" } as never);
        await ctx.db.insert("maintenanceRecordAssets", { id: "mra1", maintenanceRecordId: "mr1", bulkAssetId: "b1" });
      }),
    TEST_AND_TAG: (t) =>
      t.run((ctx) => ctx.db.insert("testTagAssets", { id: "tt1", organizationId: ORG, bulkAssetId: "b1", testTagId: "T-1", description: "T-1", status: "NOT_YET_TESTED", isActive: true, lastTestDate: NOW, createdAt: NOW, updatedAt: NOW } as never)),
    CHECK: (t) =>
      t.run((ctx) => ctx.db.insert("checkRecords", { id: "cr1", organizationId: ORG, context: "AD_HOC", bulkAssetId: "b1", checkItemId: "ci1", checkItemLabelSnapshot: "Casing", checkItemTypeSnapshot: "PASS_FAIL", result: "PASS", performedById: "u1" } as never)),
    ACCESSORY: (t) =>
      t.run((ctx) => ctx.db.insert("assetBulkChildren", { id: "bc1", organizationId: ORG, parentAssetId: "a1", bulkAssetId: "b1", quantity: 2, addedById: "u1" } as never)),
  };

  test.each(Object.keys(reasons))("%s blocks the delete and leaves the row", async (reason) => {
    const t = makeT();
    await seedBulk(t);
    await reasons[reason](t);
    await expect(del(t)).rejects.toThrow(/can't be deleted because/);
    expect(await bulk(t)).not.toBeNull();
  });

  test("a bare row deletes", async () => {
    const t = makeT();
    await seedBulk(t);
    await del(t);
    expect(await bulk(t)).toBeNull();
  });
});

describe("the exact edit Undo", () => {
  const undo = (t: T, auditId: string, id = "a1") =>
    t.withIdentity(SERVICE).mutation(api.assetWrites.undoUpdateNative, { id, orgId: ORG, auditId, actor: ME, now: NOW });

  test("an audit row for a DIFFERENT entity (id or type) is refused and changes nothing", async () => {
    const t = makeT();
    await seed(t);
    await update(t, { notes: "edited" }, "e1");
    // e1 belongs to a1: pointing a2 at it is refused, a2 is untouched
    await expect(undo(t, "e1", "a2")).rejects.toThrow(/not found/);
    expect((await getAsset(t, "a2"))?.notes).toBeUndefined();
    expect((await getAsset(t))?.notes).toBe("edited");
    // the same audit id re-typed as another entity type is refused too
    await t.run(async (ctx) => {
      const row = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "e1")).first();
      await ctx.db.patch(row!._id, { entityType: "bulkAsset" });
    });
    await expect(undo(t, "e1")).rejects.toThrow(/not found/);
    expect((await getAsset(t))?.notes).toBe("edited");
  });

  test("another org's undo marker with the same id does not count as already undone", async () => {
    const t = makeT();
    await seed(t);
    await update(t, { notes: "edited" }, "e1");
    await t.run((ctx) => ctx.db.insert("activityLogs", { id: "undo:e1", organizationId: OTHER, action: "UPDATE", entityType: "asset", entityId: "zz", entityName: "x", userId: "u9", userName: "Z", summary: "x", createdAt: NOW } as never));
    await undo(t, "e1");
    expect((await getAsset(t))?.notes).toBeUndefined();
  });

  test("a caller without asset:update cannot undo, even as the author", async () => {
    const t = makeT();
    await seed(t);
    await update(t, { notes: "edited" }, "e1");
    await t.run((ctx) => ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: ME.userId, role: "viewer" }));
    await expect(
      t.withIdentity({ subject: ME.userId, orgId: ORG }).mutation(api.assetWrites.undoUpdateNative, { id: "a1", orgId: ORG, auditId: "e1", actor: ME, now: NOW }),
    ).rejects.toThrow(/insufficient permissions/i);
    expect((await getAsset(t))?.notes).toBe("edited");
  });
});
