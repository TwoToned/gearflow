// @vitest-environment node
//
// Custom (free-text, not-in-inventory) accessories: per-model rows + per-line
// `accessoryPlan.custom`. They must expand, reconcile, prep, deploy and return
// exactly like catalog accessories.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { checkoutItemsCore, checkinItemsCore } from "./warehouseOps";
import {
  prepUnit, expandAccessoryChildLines, reconcileLineAccessoryChildren, modelCustomAccessoryKey, type AccessoryPlan,
} from "./lib/fulfillment";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const parent = (quantity: number, plan: AccessoryPlan | null = null) => ({
  id: "L1", assetId: null, modelId: "mdl", quantity, categoryId: null, groupId: null, duration: null, pricingType: null,
  organizationId: ORG, projectId: "P1", versionId: "v-P1", accessoryPlan: plan,
});

async function seed(t: T, plan: AccessoryPlan | null = null, quantity = 2) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
    await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "Headset", assetType: "SERIALIZED" });
    for (const id of ["A0", "A1"]) await ctx.db.insert("assets", { id, organizationId: ORG, modelId: "mdl", assetTag: id, status: "AVAILABLE" });
    await ctx.db.insert("modelCustomAccessories", { id: "mca1", organizationId: ORG, modelId: "mdl", name: "Foam windshield", quantity: 1, addedById: USER });
    await ctx.db.insert("modelCustomAccessories", { id: "mca2", organizationId: ORG, modelId: "mdl", name: "Carry pouch", quantity: 1, inclusion: "OPTIONAL", addedById: USER });
    await ctx.db.insert("projects", {
      id: "P1", organizationId: ORG, projectNumber: "P1", name: "Job", status: "CONFIRMED", isTemplate: false,
      rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW, liveVersionId: "v-P1",
    });
    await ctx.db.insert("projectVersions", { id: "v-P1", organizationId: ORG, projectId: "P1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "L1", organizationId: ORG, projectId: "P1", modelId: "mdl", status: "CONFIRMED", quantity, type: "EQUIPMENT",
      versionId: "v-P1", lineageId: "L1", isKitChild: false, accessoryPlan: plan ?? undefined, createdAt: NOW, updatedAt: NOW,
    });
    await expandAccessoryChildLines(ctx, parent(quantity, plan));
  });
}

const children = (t: T) =>
  t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "L1")).collect());
const unitsOf = (t: T, lineId: string) =>
  t.run((ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineId)).collect());

describe("custom accessories", () => {
  test("model DEFAULT custom accessory expands scaled by quantity; OPTIONAL does not", async () => {
    const t = makeT();
    await seed(t);
    const kids = await children(t);
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({
      customAccessoryKey: modelCustomAccessoryKey("mca1"), childKind: "ACCESSORY", isKitChild: true,
      quantity: 2, description: "2x Foam windshield", accessoryInclusion: "DEFAULT",
    });
  });

  test("plan.excluded drops a model custom default; plan.added opts an optional in", async () => {
    const t = makeT();
    await seed(t, { excluded: [modelCustomAccessoryKey("mca1")], added: [{ bulkAssetId: modelCustomAccessoryKey("mca2") }] });
    const kids = await children(t);
    expect(kids.map((k) => k.customAccessoryKey)).toEqual([modelCustomAccessoryKey("mca2")]);
  });

  test("a per-line plan.custom accessory is a normal accessory child, reconciled in and out", async () => {
    const t = makeT();
    await seed(t);
    const withCustom: AccessoryPlan = { excluded: [], added: [], custom: [{ key: "k1", name: "Gaffer tape", quantityPerParent: 3 }] };
    await t.run(async (ctx) => {
      await ctx.db.patch((await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "L1")).unique())!._id, { accessoryPlan: withCustom });
      await reconcileLineAccessoryChildren(ctx, parent(2), withCustom);
    });
    let kids = await children(t);
    expect(kids.find((k) => k.customAccessoryKey === "k1")).toMatchObject({ quantity: 6, description: "6x Gaffer tape", childKind: "ACCESSORY" });

    await t.run((ctx) => reconcileLineAccessoryChildren(ctx, parent(2), { excluded: [], added: [] }));
    kids = await children(t);
    expect(kids.find((k) => k.customAccessoryKey === "k1")).toBeUndefined();
  });

  test("prep → deploy → return carries the custom accessory with serialised parents", async () => {
    const t = makeT();
    const plan: AccessoryPlan = { excluded: [], added: [], custom: [{ key: "k1", name: "Gaffer tape", quantityPerParent: 3 }] };
    await seed(t, plan);
    for (const assetId of ["A0", "A1"]) await t.run((ctx) => prepUnit(ctx, { organizationId: ORG, lineItemId: "L1", assetId }));

    const tape = (await children(t)).find((k) => k.customAccessoryKey === "k1")!;
    expect(tape.quantity).toBe(6);
    let units = await unitsOf(t, tape.id);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.prepStatus === "PACKED" && !u.assetId && !u.bulkAssetId && u.quantity === 3)).toBe(true);

    await t.run((ctx) => checkoutItemsCore(ctx, {
      organizationId: ORG, projectId: "P1", userId: USER, now: NOW, includeAccessories: true,
      items: [{ lineItemId: "L1", assetId: "A0" }, { lineItemId: "L1", assetId: "A1" }],
    }));
    units = await unitsOf(t, tape.id);
    expect(units.every((u) => u.status === "CHECKED_OUT")).toBe(true);

    await t.run((ctx) => checkinItemsCore(ctx, {
      organizationId: ORG, projectId: "P1", userId: USER, now: NOW,
      items: [
        { lineItemId: "L1", assetId: "A0", returnCondition: "GOOD" },
        { lineItemId: "L1", assetId: "A1", returnCondition: "GOOD" },
      ],
    }));
    units = await unitsOf(t, tape.id);
    expect(units.every((u) => u.status === "RETURNED")).toBe(true);
  });
});

// ─── Accessories on a custom (free-text) item ───────────────────────────────

describe("custom accessories on a custom item", () => {
  const asUser = { subject: USER, orgId: ORG };
  const ACTOR = { userId: USER, userName: "Alice" };

  async function seedCustomItem(t: T, accessoryPlan?: AccessoryPlan, quantity = 2) {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "member" });
      await ctx.db.insert("projects", { liveVersionId: "v-P1", id: "P1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectVersions", { id: "v-P1", organizationId: ORG, projectId: "P1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    });
    await t.withIdentity(asUser).mutation(api.lineItemWrites.addCustomNative, {
      id: "L1", organizationId: ORG, projectId: "P1", fields: { description: "Bespoke rig", quantity, unitPrice: 100 },
      accessoryPlan, actor: ACTOR, auditId: "a1", now: NOW,
    });
  }

  test("addCustomNative with plan.custom creates normal accessory children", async () => {
    const t = makeT();
    await seedCustomItem(t, { excluded: [], added: [], custom: [{ key: "k1", name: "Spare fuse", quantityPerParent: 3 }] });
    const kids = await children(t);
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({ customAccessoryKey: "k1", childKind: "ACCESSORY", isKitChild: true, quantity: 6, description: "6x Spare fuse" });
  });

  test("a custom item with no plan gets no children; Edit accessories can add and remove one", async () => {
    const t = makeT();
    await seedCustomItem(t);
    expect(await children(t)).toHaveLength(0);

    const plan = { excluded: [], added: [], custom: [{ key: "k1", name: "Spare fuse", quantityPerParent: 1 }] };
    await t.withIdentity(asUser).mutation(api.lineItemWrites.updateAccessoryPlanNative, { id: "L1", organizationId: ORG, accessoryPlan: plan, actor: ACTOR, auditId: "a2", now: NOW });
    expect((await children(t)).map((k) => k.customAccessoryKey)).toEqual(["k1"]);

    await t.withIdentity(asUser).mutation(api.lineItemWrites.updateAccessoryPlanNative, { id: "L1", organizationId: ORG, accessoryPlan: { excluded: [], added: [] }, actor: ACTOR, auditId: "a3", now: NOW });
    expect(await children(t)).toHaveLength(0);
  });

  test("changing the custom item's quantity rescales its custom accessory", async () => {
    const t = makeT();
    await seedCustomItem(t, { excluded: [], added: [], custom: [{ key: "k1", name: "Spare fuse", quantityPerParent: 2 }] }, 2);
    await t.withIdentity(asUser).mutation(api.lineItemWrites.patchNative, { id: "L1", orgId: ORG, entityName: "Bespoke rig", allowOverbook: false, set: { quantity: 5, updatedAt: NOW }, clear: [], actor: ACTOR, auditId: "a4", now: NOW });
    expect((await children(t))[0].quantity).toBe(10);
  });

  test("whole-line prep packs the custom accessory, then deploy and return carry it", async () => {
    const t = makeT();
    await seedCustomItem(t, { excluded: [], added: [], custom: [{ key: "k1", name: "Spare fuse", quantityPerParent: 1 }] }, 1);
    await t.run((ctx) => prepUnit(ctx, { organizationId: ORG, lineItemId: "L1" }));
    const fuse = (await children(t))[0];
    expect((await unitsOf(t, fuse.id)).every((u) => u.prepStatus === "PACKED")).toBe(true);

    await t.run((ctx) => checkoutItemsCore(ctx, { organizationId: ORG, projectId: "P1", userId: USER, now: NOW, includeAccessories: true, items: [{ lineItemId: "L1" }] }));
    expect((await unitsOf(t, fuse.id)).every((u) => u.status === "CHECKED_OUT")).toBe(true);

    await t.run((ctx) => checkinItemsCore(ctx, { organizationId: ORG, projectId: "P1", userId: USER, now: NOW, items: [{ lineItemId: "L1", returnCondition: "GOOD" }] }));
    expect((await unitsOf(t, fuse.id)).every((u) => u.status === "RETURNED")).toBe(true);
  });
});
