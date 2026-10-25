// @vitest-environment node
//
// Direct (no-check-items) deprep of a RETURNED accessory parent. deprepItemInner
// used to reset only the parent line, leaving its RETURNED+PACKED accessory lines
// behind — and the warehouse page keeps an accessory parent on the Returned tab
// while any accessory is still RETURNED+PACKED (isInReturnedStage). The toast said
// "Removed 1 from prep", the item stayed put, and every retry was a no-op. Same
// shape when the gear had also gone out on another job before being de-prepped.
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

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** Two jobs, one parent asset (as1) that carries one serialised accessory (as2). */
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    for (const p of ["pA", "pB"]) {
      await ctx.db.insert("projects", { id: p, organizationId: ORG, projectNumber: p, name: p, createdAt: NOW, updatedAt: NOW });
    }
    await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Handheld", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "as1", organizationId: ORG, modelId: "mdl1", assetTag: "AS1", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "as2", organizationId: ORG, modelId: "mdl1", assetTag: "AS2", status: "AVAILABLE", isActive: true, parentAssetId: "as1", createdAt: NOW, updatedAt: NOW });
    for (const [id, p] of [["LA", "pA"], ["LB", "pB"]]) {
      await ctx.db.insert("projectLineItems", {
        id, organizationId: ORG, projectId: p, type: "EQUIPMENT", modelId: "mdl1", assetId: "as1",
        quantity: 1, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
      });
    }
  });
}

const S = (t: T) => t.withIdentity(SERVICE);
const prep = (t: T, projectId: string, lineItemId: string) =>
  S(t).mutation(api.checkRecordOps.prepItems, { organizationId: ORG, projectId, items: [{ lineItemId, assetId: "as1" }], now: NOW });
const deploy = (t: T, projectId: string, lineItemId: string) =>
  S(t).mutation(api.warehouseOps.checkoutItems, { organizationId: ORG, projectId, userId: USER, items: [{ lineItemId, assetId: "as1" }], includeAccessories: true, now: NOW });
const ret = (t: T, projectId: string, lineItemId: string) =>
  S(t).mutation(api.warehouseOps.checkinItems, { organizationId: ORG, projectId, userId: USER, items: [{ lineItemId, assetId: "as1", returnCondition: "GOOD" }], now: NOW });
const deprep = (t: T, projectId: string, lineItemId: string) =>
  S(t).mutation(api.checkRecordOps.deprepItems, { organizationId: ORG, projectId, ops: [{ lineItemId, quantity: 1 }], now: NOW });

const line = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique());
const accessoryLine = (t: T, parentId: string) =>
  t.run(async (ctx) => (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", parentId)).collect())[0]);
const accessoryUnit = (t: T, accLineId: string) =>
  t.run(async (ctx) => (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", accLineId)).collect())[0]);

async function expectFullyDepreped(t: T, parentId: string) {
  expect((await line(t, parentId))?.prepStatus).toBe("PENDING");
  const acc = await accessoryLine(t, parentId);
  expect(acc?.status).toBe("RETURNED");
  expect(acc?.prepStatus).toBe("PENDING");
  expect((await accessoryUnit(t, acc!.id))?.prepStatus).toBe("PENDING");
}

describe("direct deprep of a returned accessory parent", () => {
  test("resets the accessories with the parent so it leaves the Returned tab", async () => {
    const t = makeT();
    await seed(t);
    await prep(t, "pA", "LA");
    await deploy(t, "pA", "LA");
    await ret(t, "pA", "LA");

    const before = await accessoryLine(t, "LA");
    expect(before?.prepStatus).toBe("PACKED");

    await deprep(t, "pA", "LA");
    await expectFullyDepreped(t, "LA");
  });

  test("returned on A, deployed + returned on B, then de-prepped from either job", async () => {
    const t = makeT();
    await seed(t);
    await prep(t, "pA", "LA");
    await deploy(t, "pA", "LA");
    await ret(t, "pA", "LA");

    await prep(t, "pB", "LB");
    await deploy(t, "pB", "LB");
    await ret(t, "pB", "LB");

    await deprep(t, "pB", "LB");
    await deprep(t, "pA", "LA");
    await expectFullyDepreped(t, "LA");
    await expectFullyDepreped(t, "LB");
  });

  test("a retry heals a parent already de-prepped without its accessories", async () => {
    const t = makeT();
    await seed(t);
    await prep(t, "pA", "LA");
    await deploy(t, "pA", "LA");
    await ret(t, "pA", "LA");
    // The pre-fix state: parent PENDING, accessory still RETURNED + PACKED.
    await t.run(async (ctx) => {
      const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "LA")).unique();
      await ctx.db.patch(l!._id, { prepStatus: "PENDING" });
    });

    await deprep(t, "pA", "LA");
    await expectFullyDepreped(t, "LA");
  });

  test("1 of 2 of the same model: the line and every unit's accessory reset together", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
      await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
      await ctx.db.insert("projects", { id: "pA", organizationId: ORG, projectNumber: "pA", name: "pA", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "Handheld", createdAt: NOW, updatedAt: NOW });
      const handhelds: Array<[string, string | undefined]> = [["h1", undefined], ["h2", undefined], ["b1", "h1"], ["b2", "h2"]];
      for (const [id, parent] of handhelds) {
        await ctx.db.insert("assets", { id, organizationId: ORG, modelId: "mdl1", assetTag: id, status: "AVAILABLE", isActive: true, ...(parent ? { parentAssetId: parent } : {}), createdAt: NOW, updatedAt: NOW });
      }
      await ctx.db.insert("projectLineItems", { id: "L2", organizationId: ORG, projectId: "pA", type: "EQUIPMENT", modelId: "mdl1", quantity: 2, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
    });
    const items = [{ lineItemId: "L2", assetId: "h1" }, { lineItemId: "L2", assetId: "h2" }];
    await S(t).mutation(api.checkRecordOps.prepItems, { organizationId: ORG, projectId: "pA", items, now: NOW });
    await S(t).mutation(api.warehouseOps.checkoutItems, { organizationId: ORG, projectId: "pA", userId: USER, items, includeAccessories: true, now: NOW });
    await S(t).mutation(api.warehouseOps.checkinItems, {
      organizationId: ORG, projectId: "pA", userId: USER, now: NOW,
      items: [{ lineItemId: "L2", assetId: "h1", returnCondition: "GOOD" }, { lineItemId: "L2", assetId: "h2", returnCondition: "DAMAGED" }],
    });

    await deprep(t, "pA", "L2");

    expect((await line(t, "L2"))?.prepStatus).toBe("PENDING");
    const kids = await t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L2")).collect());
    expect(kids).toHaveLength(2);
    for (const k of kids) expect(k.prepStatus).toBe("PENDING");
  });
});
