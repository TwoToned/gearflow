// @vitest-environment node
//
// Regression — accessory cascades must be scoped to the parent unit(s) that
// actually moved, and de-prep must reset the accessory child LINES. A model-level
// line with two assets (a1, a2), each carrying its own serialised accessory.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const ACTOR = { userId: USER, userName: "Alice" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Handheld", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m2", organizationId: ORG, name: "Antenna", createdAt: NOW, updatedAt: NOW });
    for (const [id, tag, parent, model] of [["a1", "HH1", undefined, "m1"], ["a2", "HH2", undefined, "m1"], ["c1", "AN1", "a1", "m2"], ["c2", "AN2", "a2", "m2"]] as const) {
      await ctx.db.insert("assets", { id, organizationId: ORG, modelId: model, assetTag: tag, status: "AVAILABLE", isActive: true, parentAssetId: parent, createdAt: NOW, updatedAt: NOW });
    }
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "m1",
      quantity: 2, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
    });
  });
}

const svc = (t: T) => t.withIdentity(SERVICE);
const prepBoth = (t: T) =>
  svc(t).mutation(api.checkRecordOps.prepItems, {
    organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR,
    items: [{ lineItemId: "L1", assetId: "a1" }, { lineItemId: "L1", assetId: "a2" }],
  });
const deployBoth = (t: T) =>
  svc(t).mutation(api.warehouseOps.checkoutItems, {
    organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true,
    items: [{ lineItemId: "L1", assetId: "a1" }, { lineItemId: "L1", assetId: "a2" }],
  });
const asset = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())?.status);
const accUnit = (t: T, parent: string) =>
  t.run(async (ctx) => {
    const kids = await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect();
    for (const k of kids) {
      const us = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", k.id)).collect();
      const u = us.find((x) => x.parentUnitAssetId === parent);
      if (u) return u;
    }
    return null;
  });

describe("accessory cascades are scoped to the parent unit that moved", () => {
  test("partial return with no assetId only returns the accessory of the parent that came back", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deployBoth(t);
    await svc(t).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW,
      items: [{ lineItemId: "L1", quantity: 1, returnCondition: "GOOD" }],
    });
    expect(await asset(t, "a1")).toBe("AVAILABLE");
    expect(await asset(t, "a2")).toBe("CHECKED_OUT");
    expect(await asset(t, "c1")).toBe("AVAILABLE");
    expect(await asset(t, "c2")).toBe("CHECKED_OUT"); // stays out with its parent a2
  });

  test("undeploy of a2 moves a2 (not a1) and only a2's accessory", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deployBoth(t);
    await svc(t).mutation(api.warehouseOps.undeployItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW,
      items: [{ lineItemId: "L1", assetId: "a2", quantity: 1 }],
    });
    expect(await asset(t, "a2")).toBe("AVAILABLE");
    expect(await asset(t, "a1")).toBe("CHECKED_OUT");
    expect(await asset(t, "c2")).toBe("AVAILABLE");
    expect(await asset(t, "c1")).toBe("CHECKED_OUT");
  });

  test("unreturn restores only the unreturned parent's accessory and clears its return data", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deployBoth(t);
    await svc(t).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW,
      items: [{ lineItemId: "L1", returnCondition: "DAMAGED" }],
    });
    await svc(t).mutation(api.warehouseOps.unreturnItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW,
      items: [{ lineItemId: "L1", assetId: "a1", quantity: 1 }],
    });
    expect((await accUnit(t, "a1"))?.status).toBe("CHECKED_OUT");
    expect((await accUnit(t, "a1"))?.returnCondition).toBeUndefined();
    expect((await accUnit(t, "a2"))?.status).toBe("RETURNED"); // a2 stayed returned
  });
});

describe("deprep resets accessory child lines", () => {
  test("after deprepping the only prepped parent, accessory lines are no longer PACKED", async () => {
    const t = makeT();
    await seed(t);
    await svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR,
      items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await svc(t).mutation(api.checkRecordOps.deprepItem, { organizationId: ORG, projectId: "p1", lineItemId: "L1", quantity: 1, now: NOW });
    const kids = await t.run(async (ctx) =>
      (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect()).filter((c) => c.childKind === "ACCESSORY"),
    );
    expect(kids.length).toBeGreaterThan(0);
    for (const k of kids) expect(k.prepStatus).not.toBe("PACKED");
  });
});

describe("force-return and the accessory deploy guard", () => {
  test("forceReturnAsset on a per-unit prepped line rolls the line up to RETURNED", async () => {
    const t = makeT();
    await seed(t);
    await svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await svc(t).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await svc(t).mutation(api.warehouseOps.forceReturnAsset, { organizationId: ORG, assetId: "a1", userId: USER, now: NOW });
    const l = await t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L1")).unique());
    expect(l?.status).not.toBe("CHECKED_OUT");
    expect(l?.checkedOutQuantity ?? 0).toBe(0);
  });

  test("a LOST accessory is left behind, not silently flipped to CHECKED_OUT", async () => {
    const t = makeT();
    await seed(t);
    await svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await t.run(async (ctx) => {
      const c1 = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "c1")).unique();
      await ctx.db.patch(c1!._id, { status: "LOST" });
    });
    await svc(t).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    expect(await asset(t, "a1")).toBe("CHECKED_OUT");
    expect(await asset(t, "c1")).toBe("LOST");
  });
});

describe("deploying an accessory left behind after its parent went out", () => {
  test("a repeat deploy carries the left-behind accessory out", async () => {
    const t = makeT();
    await seed(t);
    await svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    // Partial deploy: narrow to a non-existent accessory id so c1 stays behind.
    await svc(t).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true,
      items: [{ lineItemId: "L1", assetId: "a1", includeAccessoryIds: ["none"] }],
    });
    expect(await asset(t, "a1")).toBe("CHECKED_OUT");
    expect(await asset(t, "c1")).toBe("AVAILABLE");
    await svc(t).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true,
      items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    expect(await asset(t, "c1")).toBe("CHECKED_OUT");
  });
});

describe("prepUnit repack safety", () => {
  test("re-prepping an already-deployed parent does not un-deploy it", async () => {
    const t = makeT();
    await seed(t);
    const prep = () => svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await prep();
    await svc(t).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await prep();
    const u = await t.run(async (ctx) => (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).collect()).find((x) => x.assetId === "a1"));
    expect(u?.status).toBe("CHECKED_OUT");
  });

  test("a narrowed prep only packs the selected accessory units", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "c1b", organizationId: ORG, modelId: "m2", assetTag: "AN1B", status: "AVAILABLE", isActive: true, parentAssetId: "a1", createdAt: NOW, updatedAt: NOW });
    });
    // First prep creates + packs both accessories; return one to CONFIRMED then re-prep narrowed to c1.
    await svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await t.run(async (ctx) => {
      const kids = await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect();
      for (const k of kids) for (const u of await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", k.id)).collect()) {
        await ctx.db.patch(u._id, { status: "CONFIRMED", prepStatus: "PENDING" });
      }
    });
    await svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR, items: [{ lineItemId: "L1", assetId: "a1", includeAccessoryIds: ["c1"] }],
    });
    const packed = await t.run(async (ctx) => {
      const out: string[] = [];
      const kids = await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect();
      for (const k of kids) for (const u of await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", k.id)).collect()) {
        if (u.prepStatus === "PACKED" && u.assetId) out.push(u.assetId);
      }
      return out;
    });
    expect(packed).toEqual(["c1"]);
  });
});

describe("accessories of a parent with no serialised asset", () => {
  test("prep packs and deploy carries a bulk accessory of an untagged multi-qty parent", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("bulkAssets", { id: "ba1", organizationId: ORG, modelId: "m2", assetTag: "BAT", isActive: true, availableQuantity: 10 });
      await ctx.db.insert("projectLineItems", {
        id: "L2", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", description: "Generic", quantity: 2, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItems", {
        id: "C2", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "L2",
        bulkAssetId: "ba1", quantity: 2, status: "CONFIRMED", accessoryInclusion: "DEFAULT", createdAt: NOW, updatedAt: NOW,
      });
    });
    await svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR, items: [{ lineItemId: "L2", quantity: 2 }],
    });
    const child = () => t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "C2")).unique());
    expect((await child())?.prepStatus).toBe("PACKED");
    await svc(t).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true, items: [{ lineItemId: "L2", quantity: 2 }],
    });
    expect((await child())?.status).toBe("CHECKED_OUT");
  });
});

describe("accessory stranded under an already-returned parent", () => {
  test("returning the parent again brings the stranded accessory home", async () => {
    const t = makeT();
    await seed(t);
    await svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await svc(t).mutation(api.warehouseOps.checkoutItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, includeAccessories: true, items: [{ lineItemId: "L1", assetId: "a1" }],
    });
    await svc(t).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, items: [{ lineItemId: "L1", assetId: "a1", returnCondition: "GOOD" }],
    });
    // Simulate the stranded state: accessory unit + asset back out under a RETURNED parent.
    await t.run(async (ctx) => {
      const u = await accUnitDoc(ctx);
      await ctx.db.patch(u!._id, { status: "CHECKED_OUT" });
      const c1 = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "c1")).unique();
      await ctx.db.patch(c1!._id, { status: "CHECKED_OUT" });
    });
    await svc(t).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW, items: [{ lineItemId: "L1", assetId: "a1", returnCondition: "GOOD" }],
    });
    expect(await asset(t, "c1")).toBe("AVAILABLE");
  });
});

async function accUnitDoc(ctx: import("./_generated/server").MutationCtx) {
  const kids = await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect();
  for (const k of kids) {
    const us = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", k.id)).collect();
    if (us[0]) return us[0];
  }
  return null;
}

describe("a de-prep scan on a multi-serial line de-preps THAT asset's unit", () => {
  test("two serial units on one line, scan the second tag: exactly the second unit is de-prepped", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deployBoth(t);
    await svc(t).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW,
      items: [{ lineItemId: "L1", returnCondition: "GOOD" }],
    });
    const prep = () => t.run(async (ctx) => Object.fromEntries(
      (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).collect()).map((u) => [u.assetId, u.prepStatus])));
    expect(await prep()).toEqual({ a1: "PACKED", a2: "PACKED" });
    await svc(t).mutation(api.checkRecordOps.deprepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, ops: [{ lineItemId: "L1", quantity: 1, assetId: "a2" }],
    });
    expect(await prep()).toEqual({ a1: "PACKED", a2: "PENDING" });
    // The FIRST unit by ordinal: count-based LIFO would have taken a2 again, so this proves the asset is honoured.
    await svc(t).mutation(api.checkRecordOps.deprepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, ops: [{ lineItemId: "L1", quantity: 1, assetId: "a1" }],
    });
    expect(await prep()).toEqual({ a1: "PENDING", a2: "PENDING" });
  });
  test("scanning a1 first de-preps a1, leaving a2", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deployBoth(t);
    await svc(t).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "p1", userId: USER, now: NOW,
      items: [{ lineItemId: "L1", returnCondition: "GOOD" }],
    });
    await svc(t).mutation(api.checkRecordOps.deprepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, ops: [{ lineItemId: "L1", quantity: 1, assetId: "a1" }],
    });
    const us = await t.run(async (ctx) => (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).collect()));
    expect(Object.fromEntries(us.map((u) => [u.assetId, u.prepStatus]))).toEqual({ a1: "PENDING", a2: "PACKED" });
  });
});

describe("de-prep by asset is exact, never a LIFO guess", () => {
  const deprep = (t: T, assetId?: string) =>
    svc(t).mutation(api.checkRecordOps.deprepItems, { organizationId: ORG, projectId: "p1", now: NOW, ops: [{ lineItemId: "L1", quantity: 1, ...(assetId ? { assetId } : {}) }] });
  const unitsLeft = (t: T) =>
    t.run(async (ctx) => (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "L1")).collect()).map((u) => [u.assetId, u.prepStatus, u.status] as const).sort());

  test("a PACKED (never out) two-serial line: de-prep by assetId removes exactly that unit and its accessory", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deprep(t, "a1"); // LIFO would have removed a2
    expect((await unitsLeft(t)).map((u) => u[0])).toEqual(["a2"]);
    expect(await accUnit(t, "a1")).toBeNull();
    expect(await accUnit(t, "a2")).not.toBeNull();
  });

  test("a named asset that is not a prepped unit on the line is refused, not guessed", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await expect(deprep(t, "a9")).rejects.toThrow(/isn't a prepped unit/);
    expect((await unitsLeft(t)).length).toBe(2);
  });

  test("RETURNED line: a named asset that is already de-prepped is refused (no LIFO fallback); no assetId keeps LIFO", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deployBoth(t);
    await svc(t).mutation(api.warehouseOps.checkinItems, { organizationId: ORG, projectId: "p1", userId: USER, now: NOW, items: [{ lineItemId: "L1", returnCondition: "GOOD" }] });
    await deprep(t, "a1");
    await expect(deprep(t, "a1")).rejects.toThrow(/already de-prepped/);
    expect(await unitsLeft(t)).toEqual([["a1", "PENDING", "RETURNED"], ["a2", "PACKED", "RETURNED"]]); // a2 untouched by the refused call
    await deprep(t); // no asset named: LIFO as before
    expect((await unitsLeft(t)).every((u) => u[1] === "PENDING")).toBe(true);
  });

  test("partially returned line: a returned unit de-preps by asset while the sibling is still out; without an asset the guard holds", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deployBoth(t);
    await svc(t).mutation(api.warehouseOps.checkinItems, { organizationId: ORG, projectId: "p1", userId: USER, now: NOW, items: [{ lineItemId: "L1", assetId: "a1", returnCondition: "GOOD" }] });
    await expect(deprep(t)).rejects.toThrow(/already deployed/);
    await deprep(t, "a1");
    expect(await unitsLeft(t)).toEqual([["a1", "PENDING", "RETURNED"], ["a2", "PACKED", "CHECKED_OUT"]]);
    expect(await asset(t, "a2")).toBe("CHECKED_OUT");
    await expect(deprep(t, "a2")).rejects.toThrow(/already deployed/); // still out: not de-preppable
  });

  test("parent A back WITHOUT its accessory: de-prep A by asset leaves the accessory unit out and its line alone", async () => {
    const t = makeT();
    await seed(t);
    await prepBoth(t);
    await deployBoth(t);
    await svc(t).mutation(api.warehouseOps.checkinItems, { organizationId: ORG, projectId: "p1", userId: USER, now: NOW, items: [{ lineItemId: "L1", assetId: "a1", returnCondition: "GOOD" }] });
    // Force the battery of a1 to stay out (parent back without it).
    const before = await t.run(async (ctx) => {
      const u = (await ctx.db.query("projectLineItemUnits").collect()).find((x) => x.parentUnitAssetId === "a1")!;
      await ctx.db.patch(u._id, { status: "CHECKED_OUT", prepStatus: "PACKED" });
      return u.lineItemId;
    });
    await deprep(t, "a1");
    const acc = await accUnit(t, "a1");
    expect(acc).toMatchObject({ status: "CHECKED_OUT", prepStatus: "PACKED" }); // untouched
    const line = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", before)).unique());
    expect(line?.prepStatus).not.toBe("PENDING"); // the battery line is not reset while a unit is out
    expect((await unitsLeft(t)).find((u) => u[0] === "a1")).toEqual(["a1", "PENDING", "RETURNED"]);
  });
});

describe("prepItems reports what an accessories-only prep actually packed", () => {
  /** Prep both parents, then put every accessory unit back to "not packed" so an accessories-only call has work. */
  async function prepThenUnpackAccessories(t: T) {
    await seed(t);
    const plain = await prepBoth(t);
    expect(plain.packedAccessoryLineIds).toEqual([]); // not an accessories-only call
    await t.run(async (ctx) => {
      for (const u of await ctx.db.query("projectLineItemUnits").collect()) {
        if (u.parentUnitAssetId) await ctx.db.patch(u._id, { prepStatus: undefined });
      }
    });
  }
  const accessoriesOnly = (t: T, items: Array<{ assetId: string; includeAccessoryIds?: string[] }>) =>
    svc(t).mutation(api.checkRecordOps.prepItems, {
      organizationId: ORG, projectId: "p1", now: NOW, actor: ACTOR,
      items: items.map((i) => ({ lineItemId: "L1", accessoriesOnly: true, ...i })),
    });

  test("reports the accessory units THIS call packed, per parent unit", async () => {
    const t = makeT();
    await prepThenUnpackAccessories(t);
    const res = await accessoriesOnly(t, [{ assetId: "a1" }, { assetId: "a2" }]);
    expect(res.packedAccessoryUnits.map((u) => u.parentUnitAssetId).sort()).toEqual(["a1", "a2"]);
    expect(res.packedAccessoryLineIds.length).toBeGreaterThan(0);
  });

  test("an accessory already PACKED before the call is not reported as packed by it", async () => {
    const t = makeT();
    await prepThenUnpackAccessories(t);
    await accessoriesOnly(t, [{ assetId: "a1" }]); // a1's accessory is now packed (earlier)
    const again = await accessoriesOnly(t, [{ assetId: "a1" }, { assetId: "a2" }]);
    expect(again.packedAccessoryUnits.map((u) => u.parentUnitAssetId)).toEqual(["a2"]); // only a2's is new
    // ...but the LINES: an already-packed accessory still reads packed for the requested parent units.
    const l1 = (await accUnit(t, "a1"))!.lineItemId;
    const l2 = (await accUnit(t, "a2"))!.lineItemId;
    expect(again.packedAccessoryLineIds).toEqual(expect.arrayContaining([l1, l2]));
    const justA1 = await accessoriesOnly(t, [{ assetId: "a1" }]); // nothing flipped at all, still packed
    expect(justA1.packedAccessoryUnits).toEqual([]);
    expect(justA1.packedAccessoryLineIds).toContain(l1);
  });

  test("a line with a requested parent unit that is still unpacked is not reported as packed", async () => {
    const t = makeT();
    await prepThenUnpackAccessories(t);
    // a2's accessory unit can't be packed any more (already returned), so the line is only partly packed for {a1, a2}.
    await t.run(async (ctx) => {
      for (const u of await ctx.db.query("projectLineItemUnits").collect()) if (u.parentUnitAssetId === "a2") await ctx.db.patch(u._id, { status: "RETURNED", prepStatus: undefined });
    });
    const l1 = (await accUnit(t, "a1"))!.lineItemId;
    const l2 = (await accUnit(t, "a2"))!.lineItemId;
    const res = await accessoriesOnly(t, [{ assetId: "a1" }, { assetId: "a2" }]);
    expect(res.packedAccessoryUnits.map((u) => u.parentUnitAssetId)).toEqual(["a1"]); // per-unit state is still reported
    expect(res.packedAccessoryLineIds).not.toContain(l2);
    // A shared line (both parents' units on one line) is partial; separate lines report a1's as packed.
    expect(res.packedAccessoryLineIds.includes(l1)).toBe(l1 !== l2);
  });

  test("a narrowed includeAccessoryIds reports only those accessories", async () => {
    const t = makeT();
    await prepThenUnpackAccessories(t);
    const none = await accessoriesOnly(t, [{ assetId: "a1", includeAccessoryIds: ["not-an-accessory"] }]);
    expect(none.packedAccessoryUnits).toEqual([]);
    expect(none.packedAccessoryLineIds).toEqual([]);
    const some = await accessoriesOnly(t, [{ assetId: "a1", includeAccessoryIds: ["c1"] }]);
    expect(some.packedAccessoryUnits.map((u) => u.parentUnitAssetId)).toEqual(["a1"]);
  });
});
