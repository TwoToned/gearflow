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
