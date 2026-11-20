// @vitest-environment node
//
// Org-wide returns-station writes (issue #944 WS5). Verifies: server-derived
// projectId (no projectId argument exists anywhere in returnScanNative/
// returnBatchNative), cross-tenant line rejection, viewer RBAC denial, batch cap
// enforcement + partial-success labelled results, the last-unit-returned
// auto-advance-to-RETURNED side effect, and post-hoc condition correction.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const SPOOF = { userId: "attacker_id", userName: "Mallory" };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function member(t: T, role: string, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m-${orgId}-${role}`, organizationId: orgId, userId: USER, role });
  });
}

async function seedProject(t: T, id: string, orgId = ORG, status: string = "CHECKED_OUT") {
  const versionId = `v-${id}-${orgId}`;
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name: "Gig", status: status as never,
      total: 0, liveVersionId: versionId,
    });
    await ctx.db.insert("projectVersions", {
      id: versionId, organizationId: orgId, projectId: id, number: 1, contentState: "ready", createdAt: 1_700_000_000_000, createdById: "u1",
    });
  });
}

async function seedModelAsset(t: T, assetId = "a1", tag = "A-1", orgId = ORG) {
  await t.run(async (ctx) => {
    const existing = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", "m1")).first();
    if (!existing) await ctx.db.insert("models", { id: "m1", organizationId: orgId, name: "PAR", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: assetId, organizationId: orgId, modelId: "m1", assetTag: tag, status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
  });
}

const baseLine = (id: string, projectId: string, extra: Record<string, unknown>, orgId = ORG) => ({
  id, organizationId: orgId, projectId, versionId: `v-${projectId}-${orgId}`, lineageId: id,
  type: "EQUIPMENT" as const, quantity: 1, sortOrder: 0,
  status: "CHECKED_OUT" as const, checkedOutQuantity: 1, isKitChild: false, createdAt: NOW, updatedAt: NOW, ...extra,
});

const unitById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const assetById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const projectById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const logById = (t: T, id: string) =>
  t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("returnScanNative", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t, "p1");
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
  }

  test("returns a serialised unit, deriving projectId server-side (no projectId arg exists)", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.projectId).toBe("p1");
    expect(res.updatedLineIds).toEqual(["li1"]);
    expect((await unitById(t, "u1"))?.status).toBe("RETURNED");
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("CHECK_IN");
    expect(log?.userId).toBe(USER); // spoofed actor overridden by verified token subject
    expect(log?.projectId).toBe("p1");
  });

  test("cross-org line item rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("liX", "pX", { modelId: "m1" }, OTHER));
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
        orgId: ORG, lineItemId: "liX", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seed(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
        orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("auto-advances the project to RETURNED when the last outstanding line comes back", async () => {
    const t = makeT();
    await seed(t); // only li1 is CHECKED_OUT on p1
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.autoAdvanced).toBe(true);
    expect((await projectById(t, "p1"))?.status).toBe("RETURNED");
  });

  test("does NOT auto-advance while another line on the project is still checked out", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li2", "p1", { modelId: "m1" }));
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnScanNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.autoAdvanced).toBe(false);
    expect((await projectById(t, "p1"))?.status).toBe("CHECKED_OUT");
  });
});

describe("returnBatchNative", () => {
  async function seed(t: T) {
    await member(t, "member");
    await seedProject(t, "p1");
    await seedModelAsset(t, "a1", "A-1");
    await seedModelAsset(t, "a2", "A-2");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("li2", "p1", { modelId: "m1", assetId: "a2" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "li2", ordinal: 0, assetId: "a2", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
  }

  test("empty batch rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnBatchNative, { orgId: ORG, items: [], batchAuditId: "b1", now: NOW, actor: SPOOF }),
    ).rejects.toThrow(/no items selected/i);
  });

  test("cap enforced — over 100 items rejected", async () => {
    const t = makeT();
    await member(t, "member");
    const items = Array.from({ length: 101 }, (_, i) => ({ lineItemId: `li${i}`, returnCondition: "GOOD" as const, auditId: `a${i}` }));
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnBatchNative, { orgId: ORG, items, batchAuditId: "b1", now: NOW, actor: SPOOF }),
    ).rejects.toThrow(/maximum 100/i);
  });

  test("partial-batch results: one bad id doesn't fail the rest", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnBatchNative, {
      orgId: ORG,
      items: [
        { lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1" },
        { lineItemId: "does-not-exist", returnCondition: "GOOD", auditId: "log2" },
        { lineItemId: "li2", assetId: "a2", returnCondition: "DAMAGED", auditId: "log3" },
      ],
      batchAuditId: "batch1", now: NOW, actor: SPOOF,
    });
    expect(res).toHaveLength(3);
    expect(res[0]).toMatchObject({ lineItemId: "li1", success: true, projectId: "p1" });
    expect(res[1]).toMatchObject({ lineItemId: "does-not-exist", success: false });
    expect(res[1].error).toMatch(/not found/i);
    expect(res[2]).toMatchObject({ lineItemId: "li2", success: true, projectId: "p1" });

    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    expect((await assetById(t, "a2"))?.status).toBe("IN_MAINTENANCE");
    // Both real returns succeeded → project's last outstanding line just returned.
    expect((await projectById(t, "p1"))?.status).toBe("RETURNED");
    const batchLog = await logById(t, "batch1");
    expect(batchLog?.summary).toMatch(/batch returned 2 of 3/i);
  });
});

describe("correctReturnConditionNative", () => {
  async function seedReturned(t: T) {
    await member(t, "member");
    await seedProject(t, "p1");
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { ...baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }), status: "RETURNED" });
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "RETURNED", returnCondition: "GOOD", createdAt: NOW, updatedAt: NOW });
      await ctx.db.patch((await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique())!._id, { status: "AVAILABLE" });
    });
  }

  test("marks an already-returned unit DAMAGED and flips the asset to IN_MAINTENANCE", async () => {
    const t = makeT();
    await seedReturned(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.correctReturnConditionNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "DAMAGED", notes: "Cracked housing", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect(res.updated).toBe(true);
    expect((await unitById(t, "u1"))?.returnCondition).toBe("DAMAGED");
    expect((await assetById(t, "a1"))?.status).toBe("IN_MAINTENANCE");
  });

  test("does not touch an asset that has since gone out on another job", async () => {
    const t = makeT();
    await seedReturned(t);
    await t.run(async (ctx) => {
      const a1 = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique();
      await ctx.db.patch(a1!._id, { status: "CHECKED_OUT" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.correctReturnConditionNative, {
      orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });
    expect((await assetById(t, "a1"))?.status).toBe("CHECKED_OUT");
  });

  test("rejects correcting an item that hasn't been returned yet", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1");
    await seedModelAsset(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("li1", "p1", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.correctReturnConditionNative, {
        orgId: ORG, lineItemId: "li1", assetId: "a1", returnCondition: "DAMAGED", auditId: "log1", now: NOW, actor: SPOOF,
      }),
    ).rejects.toThrow(/has not been returned/i);
  });
});

// Phase 4: the floor's Undo for a bulk-tag return reverses exactly the
// allocations this call returned, through the existing `unreturnItems`.
describe("returnBulkNative allocations + Undo", () => {
  async function seedBulk(t: T, opts: { qty: number; returned?: number; orgId?: string } = { qty: 10 }) {
    const orgId = opts.orgId ?? ORG;
    await member(t, "member", orgId);
    await seedProject(t, "p1", orgId);
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: orgId, name: "Cable", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: orgId, modelId: "m1", assetTag: "CAB", totalQuantity: 50, availableQuantity: 40 });
      await ctx.db.insert("projectLineItems", baseLine("bl", "p1", { modelId: "m1", bulkAssetId: "ba1", quantity: opts.qty, checkedOutQuantity: opts.qty, returnedQuantity: opts.returned ?? 0 }, orgId));
      await ctx.db.insert("projectLineItemUnits", {
        id: "bu1", organizationId: orgId, lineItemId: "bl", ordinal: 0, bulkAssetId: "ba1", quantity: opts.qty,
        returnedQuantity: opts.returned ?? 0, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW,
      });
    });
  }
  const returnBulk = (t: T, quantity: number) =>
    t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.returnBulkNative, {
      orgId: ORG, bulkAssetId: "ba1", projectId: "p1", quantity, returnCondition: "GOOD", auditId: "log1", now: NOW, actor: SPOOF,
    });

  const undo = (t: T, res: { returnedUnitIds: string[]; autoStatusAuditId: string | null }) =>
    t.withIdentity(asUser(ORG)).mutation(api.returnsWrites.unreturnBulkNative, {
      orgId: ORG, projectId: "p1", unitIds: res.returnedUnitIds, auditId: "undo1",
      revertAutoAdvanceAuditId: res.autoStatusAuditId ?? undefined, now: NOW + 1, actor: SPOOF,
    });

  /** An ACCESSORY child line on `bl` with the given units. */
  async function seedAccessory(t: T, units: Array<{ id: string; status: string; containerId?: string }>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("acc", "p1", {
        modelId: "m1", quantity: units.length, checkedOutQuantity: units.length, isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "bl",
      }));
      for (const [i, u] of units.entries()) {
        await ctx.db.insert("projectLineItemUnits", {
          id: u.id, organizationId: ORG, lineItemId: "acc", ordinal: i, quantity: 1, status: u.status as never,
          ...(u.containerId ? { containerId: u.containerId } : {}), createdAt: NOW, updatedAt: NOW,
        });
      }
    });
  }

  test("returns the allocations, the exact units it flipped and the auto-advance audit id", async () => {
    const t = makeT();
    await seedBulk(t, { qty: 10 });
    const res = await returnBulk(t, 10);
    expect(res.allocations).toEqual([{ lineItemId: "bl", quantity: 10 }]);
    expect(res.returnedUnitIds).toEqual(["bu1"]);
    expect(res.distributed).toBe(10);
    expect(res.autoStatus).toBe("RETURNED");
    expect(res.autoStatusAuditId).toEqual(expect.any(String));
    expect(res.exactUndo).toBe(true);
  });

  test("Undo moves exactly those units back out and reverts the job's auto-advance", async () => {
    const t = makeT();
    await seedBulk(t, { qty: 10 });
    const res = await returnBulk(t, 10);
    expect((await projectById(t, "p1"))?.status).toBe("RETURNED");
    await undo(t, res);
    const unit = await unitById(t, "bu1");
    expect(unit?.status).toBe("CHECKED_OUT");
    expect(unit?.returnedQuantity ?? 0).toBe(0);
    expect((await projectById(t, "p1"))?.status).toBe("CHECKED_OUT");
  });

  test("an accessory returned separately AFTER the bulk return stays RETURNED through its Undo", async () => {
    const t = makeT();
    await seedBulk(t, { qty: 10 });
    // ac2 is packed in another container, so the parent's cascade leaves it out.
    await seedAccessory(t, [{ id: "ac1", status: "CHECKED_OUT" }, { id: "ac2", status: "CHECKED_OUT", containerId: "case-9" }]);
    const res = await returnBulk(t, 10);
    expect(res.returnedUnitIds.sort()).toEqual(["ac1", "bu1"]);
    await t.withIdentity(asUser(ORG)).mutation(api.warehouseWrites.stageAccessoryUnits, {
      orgId: ORG, projectId: "p1", unitIds: ["ac2"], to: "RETURN", auditId: "log2", now: NOW, actor: SPOOF,
    });
    expect((await unitById(t, "ac2"))?.status).toBe("RETURNED");

    await undo(t, res);
    expect((await unitById(t, "bu1"))?.status).toBe("CHECKED_OUT");
    expect((await unitById(t, "ac1"))?.status).toBe("CHECKED_OUT");
    expect((await unitById(t, "ac2"))?.status).toBe("RETURNED");
  });

  test("an accessory returned BEFORE the bulk return is not in its Undo", async () => {
    const t = makeT();
    await seedBulk(t, { qty: 10 });
    await seedAccessory(t, [{ id: "ac1", status: "RETURNED" }, { id: "ac2", status: "CHECKED_OUT" }]);
    const res = await returnBulk(t, 10);
    expect(res.returnedUnitIds.sort()).toEqual(["ac2", "bu1"]);
    await undo(t, res);
    expect((await unitById(t, "ac1"))?.status).toBe("RETURNED");
    expect((await unitById(t, "ac2"))?.status).toBe("CHECKED_OUT");
  });

  test("Undo refuses when one of its units has changed since", async () => {
    const t = makeT();
    await seedBulk(t, { qty: 10 });
    const res = await returnBulk(t, 10);
    await t.run(async (ctx) => {
      const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", "bu1")).unique();
      await ctx.db.patch(u!._id, { status: "CHECKED_OUT" as never });
    });
    await expect(undo(t, res)).rejects.toThrow(/changed since/i);
  });

  test("Undo rejects a unit from another org", async () => {
    const t = makeT();
    await seedBulk(t, { qty: 10 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", { id: "foreign", organizationId: OTHER, lineItemId: "bl", ordinal: 9, quantity: 1, status: "RETURNED" as never, createdAt: NOW, updatedAt: NOW });
    });
    await expect(undo(t, { returnedUnitIds: ["foreign"], autoStatusAuditId: null })).rejects.toThrow(/not on this job/i);
  });

  /** A bulk line whose accessory child is one serialised asset `a1`, out on p1. */
  async function seedWithSerialAccessory(t: T) {
    await seedBulk(t, { qty: 10 });
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "CHECKED_OUT", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", baseLine("acc", "p1", {
        modelId: "m1", assetId: "a1", quantity: 1, checkedOutQuantity: 1, isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "bl",
      }));
      await ctx.db.insert("projectLineItemUnits", { id: "ac1", organizationId: ORG, lineItemId: "acc", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
    });
  }

  test("Undo refuses when a returned asset has since gone out on another job (no double deployment)", async () => {
    const t = makeT();
    await seedWithSerialAccessory(t);
    const res = await returnBulk(t, 10);
    expect(res.returnedUnitIds.sort()).toEqual(["ac1", "bu1"]);
    expect((await assetById(t, "a1"))?.status).toBe("AVAILABLE");
    // A1 is deployed on job 2.
    await seedProject(t, "p2");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", baseLine("l2", "p2", { modelId: "m1", assetId: "a1" }));
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "l2", ordinal: 0, assetId: "a1", quantity: 1, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
      const a1 = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique();
      await ctx.db.patch(a1!._id, { status: "CHECKED_OUT" });
    });
    await expect(undo(t, res)).rejects.toThrow(/changed since/i);
    expect((await unitById(t, "ac1"))?.status).toBe("RETURNED");
    expect((await unitById(t, "bu1"))?.status).toBe("RETURNED");
  });

  test("Undo refuses when a returned asset has since gone into maintenance", async () => {
    const t = makeT();
    await seedWithSerialAccessory(t);
    const res = await returnBulk(t, 10);
    await t.run(async (ctx) => {
      const a1 = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique();
      await ctx.db.patch(a1!._id, { status: "IN_MAINTENANCE" });
    });
    await expect(undo(t, res)).rejects.toThrow(/changed since/i);
  });

  test("a return of more units than the Undo cap offers no Undo", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1");
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Cable", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: ORG, modelId: "m1", assetTag: "CAB", totalQuantity: 1000, availableQuantity: 0 });
      await ctx.db.insert("projectLineItems", baseLine("bl", "p1", { modelId: "m1", bulkAssetId: "ba1", quantity: 501, checkedOutQuantity: 501 }));
      for (let i = 0; i < 501; i++) {
        await ctx.db.insert("projectLineItemUnits", {
          id: `bu${i}`, organizationId: ORG, lineItemId: "bl", ordinal: i, bulkAssetId: "ba1", quantity: 1, returnedQuantity: 0, status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW,
        });
      }
    });
    const res = await returnBulk(t, 501);
    expect(res.returnedUnitIds).toHaveLength(501);
    expect(res.exactUndo).toBe(false);
  });

  test("a partial bulk return has no exact Undo", async () => {
    const t = makeT();
    await seedBulk(t, { qty: 10 });
    const res = await returnBulk(t, 4);
    expect(res.exactUndo).toBe(false);
    expect(res.returnedUnitIds).toEqual([]);
  });

  test("a foreign org's bulk asset is rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1");
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: OTHER, modelId: "m1", assetTag: "CAB" });
    });
    await expect(returnBulk(t, 1)).rejects.toThrow(/not found/i);
  });
});
