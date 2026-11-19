// @vitest-environment node
//
// Off-inventory units keep the model's accessories (user request, FEATUREDOCS/12 + /48):
// converting a unit to a custom item must not lose the accessories that unit would have
// shipped with, and they must prep / deploy / return with it.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { convertUnitToOffInventoryCore, convertUnitBackToInventoryCore, checkoutItemsCore, checkinItemsCore } from "./warehouseOps";
import { prepUnit, expandAccessoryChildLines, customUnitAccessoryShare } from "./lib/fulfillment";
import { api } from "./_generated/api";

const SERVICE = { subject: "gearflow-service", svc: true };

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const base = { organizationId: ORG, projectId: "P1", lineItemId: "L1", now: NOW };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** 3x "4099" (2 serials A0/A1 + 1 custom to come), each shipping with 2x clips (bulk B1). */
async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "4099", assetType: "SERIALIZED" });
    await ctx.db.insert("models", { id: "mdlClip", organizationId: ORG, name: "Clip", assetType: "BULK" });
    for (const id of ["A0", "A1"]) await ctx.db.insert("assets", { id, organizationId: ORG, modelId: "mdl", assetTag: id, status: "AVAILABLE" });
    await ctx.db.insert("bulkAssets", { id: "B1", organizationId: ORG, modelId: "mdlClip", assetTag: "CLIP", totalQuantity: 50, availableQuantity: 50 });
    await ctx.db.insert("modelBulkAccessories", { id: "mba1", organizationId: ORG, modelId: "mdl", bulkAssetId: "B1", quantity: 2, addedById: USER });
    await ctx.db.insert("projects", {
      id: "P1", organizationId: ORG, projectNumber: "P1", name: "Job", status: "CONFIRMED", isTemplate: false,
      rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW, liveVersionId: "v-P1",
    });
    await ctx.db.insert("projectVersions", { id: "v-P1", organizationId: ORG, projectId: "P1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "P1", modelId: "mdl", status: "CONFIRMED", quantity: 3, type: "EQUIPMENT",
      versionId: "v-P1", lineageId: "L1", isKitChild: false, createdAt: NOW, updatedAt: NOW,
    });
    await expandAccessoryChildLines(ctx, {
      id: "L1", assetId: null, modelId: "mdl", quantity: 3, categoryId: null, groupId: null, duration: null, pricingType: null,
      organizationId: ORG, projectId: "P1", versionId: "v-P1",
    });
  });
}

const clipLine = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect()).find((c) => c.bulkAssetId === "B1"));
const clipUnits = (t: T) =>
  t.run(async (ctx) => {
    const c = (await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect()).find((x) => x.bulkAssetId === "B1");
    return c ? ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", c.id)).collect() : [];
  });
const prepSerials = async (t: T) => {
  for (const assetId of ["A0", "A1"]) await t.run((ctx) => prepUnit(ctx, { organizationId: ORG, lineItemId: "L1", assetId }));
};

describe("the model's accessories stay with a converted unit", () => {
  test("baseline: accessories exist at 2 per parent x 3 parents", async () => {
    const t = makeT();
    await seed(t);
    expect((await clipLine(t))?.quantity).toBe(6);
  });

  test("prepping the serials after converting keeps the custom unit's clips on the accessory line", async () => {
    const t = makeT();
    await seed(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    await prepSerials(t);
    expect((await clipLine(t))?.quantity).toBe(6); // not shrunk to 4 (2 parents x 2)
  });

  test("converting after the serials were prepped keeps all 6 clips and packs the custom unit's share", async () => {
    const t = makeT();
    await seed(t);
    await prepSerials(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    expect((await clipLine(t))?.quantity).toBe(6);
    const packed = (await clipUnits(t)).filter((u) => u.prepStatus === "PACKED").reduce((n, u) => n + (u.quantity ?? 0), 0);
    expect(packed).toBe(6);
  });

  test("whole-line deploy and return carry every clip, custom share included", async () => {
    const t = makeT();
    await seed(t);
    await prepSerials(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    const common = { organizationId: ORG, projectId: "P1", userId: USER, now: NOW };

    await t.run((ctx) => checkoutItemsCore(ctx, { ...common, items: [{ lineItemId: "L1" }], includeAccessories: true }));
    let us = await clipUnits(t);
    expect(us.filter((u) => u.status === "CHECKED_OUT").reduce((n, u) => n + (u.quantity ?? 0), 0)).toBe(6);

    await t.run((ctx) => checkinItemsCore(ctx, { ...common, items: [{ lineItemId: "L1", returnCondition: "GOOD" }] }));
    us = await clipUnits(t);
    expect(us.every((u) => u.status === "RETURNED")).toBe(true);
  });

  test("converting back releases the custom unit's clips", async () => {
    const t = makeT();
    await seed(t);
    await prepSerials(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    await t.run((ctx) => convertUnitBackToInventoryCore(ctx, { organizationId: ORG, projectId: "P1", lineItemId: "L1", now: NOW }));
    const packed = (await clipUnits(t)).filter((u) => u.prepStatus === "PACKED").reduce((n, u) => n + (u.quantity ?? 0), 0);
    expect(packed).toBe(4); // only the two serials' clips remain packed
    expect((await clipLine(t))?.quantity).toBe(6); // the line still plans clips for 3 parents
  });
});

describe("scoping and plan rules", () => {
  test("deploying a serial deploys only ITS clips; the custom unit's stay until it deploys", async () => {
    const t = makeT();
    await seed(t);
    await prepSerials(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    await t.run((ctx) =>
      checkoutItemsCore(ctx, { organizationId: ORG, projectId: "P1", userId: USER, now: NOW, items: [{ lineItemId: "L1", assetId: "A0" }], includeAccessories: true }),
    );
    const out = (await clipUnits(t)).filter((u) => u.status === "CHECKED_OUT");
    expect(out).toHaveLength(1);
    expect(out[0].parentUnitAssetId).toBe("A0");
  });

  test("de-prepping the custom unit takes its clips off the line's units", async () => {
    const t = makeT();
    await seed(t);
    await prepSerials(t);
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.deprepItem, { organizationId: ORG, projectId: "P1", lineItemId: "L1", quantity: 1, now: NOW });
    expect((await clipUnits(t)).filter((u) => u.parentUnitAssetId?.startsWith("custom:"))).toHaveLength(0);
  });

  test("a custom unit ships only with the accessories the line's plan includes", async () => {
    const t = makeT();
    await seed(t);
    const share = (plan: unknown, model = "mdl") => t.run((ctx) => customUnitAccessoryShare(ctx, { modelId: model, accessoryPlan: plan }));
    expect(await share(undefined)).toEqual([{ bulkAssetId: "B1", perParent: 2 }]);
    expect(await share({ excluded: ["B1"], added: [] })).toEqual([]);
    expect(await share(undefined, "no-such-model")).toEqual([]);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("modelBulkAccessories").first();
      await ctx.db.patch(m!._id, { inclusion: "OPTIONAL" });
    });
    expect(await share(undefined)).toEqual([]); // OPTIONAL, not opted in
    expect(await share({ excluded: [], added: [{ bulkAssetId: "B1", quantityPerParent: 5 }] })).toEqual([{ bulkAssetId: "B1", perParent: 5 }]);
  });

  test("a line whose model has no accessories converts exactly as before", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("modelBulkAccessories").first();
      await ctx.db.delete(m!._id);
    });
    await t.run((ctx) => convertUnitToOffInventoryCore(ctx, base));
    expect(await clipUnits(t)).toHaveLength(0);
  });
});
