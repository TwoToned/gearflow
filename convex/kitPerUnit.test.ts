// @vitest-environment node
//
// Kit per-unit fulfillment (Phase 1) — docs/designs/kit-per-unit-fulfillment.md.
// Verifies that kit MEMBER UNIT rows are seeded at kit-add and flipped through
// every warehouse kit operation, while the legacy line/asset path keeps working
// (belt still owns asset status this phase).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
type T = ReturnType<typeof convexTest>;

/** Seed a kit (serialised member A-1, optional bulk member B-1 qty 3) and build
 *  its project line items + member units via the real createKitLineItem path. */
async function seedKit(t: T, opts?: { bulk?: boolean }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "Lighting", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "a1", addedById: USER });
    if (opts?.bulk) {
      await ctx.db.insert("bulkAssets", { id: "b1", organizationId: ORG, modelId: "m1", assetTag: "B-1", availableQuantity: 10, totalQuantity: 10, isActive: true });
      await ctx.db.insert("kitBulkItems", { id: "kb1", organizationId: ORG, kitId: "k1", bulkAssetId: "b1", quantity: 3, addedById: USER });
    }
  });
  await t.withIdentity(SERVICE).mutation(api.projectLineItems.createKitLineItem, { id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1", pricingMode: "KIT_PRICE", now: NOW });
}

/** All member units under the kit parent line kl1. */
function memberUnits(t: T) {
  return t.run(async (ctx) => {
    const children = await ctx.db.query("projectLineItems").withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", "kl1")).collect();
    const out = [] as Array<Record<string, unknown>>;
    for (const c of children) {
      const us = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", c.id)).collect();
      out.push(...us);
    }
    return out;
  });
}
const serialUnit = (units: Array<Record<string, unknown>>) => units.find((u) => u.assetId === "a1")!;
const bulkUnit = (units: Array<Record<string, unknown>>) => units.find((u) => u.bulkAssetId === "b1")!;
const assetStatus = (t: T) => t.run(async (ctx) => (await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique())?.status);

const co = (t: T) => t.withIdentity(SERVICE).mutation(api.warehouseOps.checkoutKit, { organizationId: ORG, projectId: "p1", userId: USER, kitId: "k1", now: NOW });
const ci = (t: T, cond: "GOOD" | "DAMAGED" | "MISSING" = "GOOD") => t.withIdentity(SERVICE).mutation(api.warehouseOps.checkinKit, { organizationId: ORG, projectId: "p1", userId: USER, kitId: "k1", returnCondition: cond, now: NOW });

describe("kit per-unit — seeding", () => {
  test("createKitLineItem seeds one CONFIRMED unit per serialised member", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    const units = await memberUnits(t);
    expect(units).toHaveLength(1);
    expect(serialUnit(units).status).toBe("CONFIRMED");
    expect(serialUnit(units).assetId).toBe("a1");
  });

  test("bulk member seeds one unit carrying its quantity", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t, { bulk: true });
    const units = await memberUnits(t);
    expect(units).toHaveLength(2);
    expect(bulkUnit(units).quantity).toBe(3);
    expect(bulkUnit(units).status).toBe("CONFIRMED");
  });
});

describe("kit per-unit — checkout / checkin", () => {
  test("checkout flips member unit → CHECKED_OUT and the belt still flips the asset", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await co(t);
    expect(serialUnit(await memberUnits(t)).status).toBe("CHECKED_OUT");
    expect(serialUnit(await memberUnits(t)).checkedOutById).toBe(USER);
    expect(await assetStatus(t)).toBe("CHECKED_OUT"); // legacy belt unchanged
  });

  test("checkin flips CHECKED_OUT member unit → RETURNED with return stamps", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await co(t);
    await ci(t, "GOOD");
    const u = serialUnit(await memberUnits(t));
    expect(u.status).toBe("RETURNED");
    expect(u.returnedQuantity).toBe(1);
    expect(u.returnCondition).toBe("GOOD");
    expect(await assetStatus(t)).toBe("AVAILABLE");
  });

  test("bulk member returns its full quantity", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t, { bulk: true });
    await co(t);
    expect(bulkUnit(await memberUnits(t)).status).toBe("CHECKED_OUT");
    await ci(t, "GOOD");
    const u = bulkUnit(await memberUnits(t));
    expect(u.status).toBe("RETURNED");
    expect(u.returnedQuantity).toBe(3);
  });

  test("DAMAGED checkin records the condition on the unit", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await co(t);
    await ci(t, "DAMAGED");
    expect(serialUnit(await memberUnits(t)).returnCondition).toBe("DAMAGED");
  });
});

describe("kit per-unit — reverse + force", () => {
  test("undeployKit: CHECKED_OUT unit → CONFIRMED (re-packed)", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await co(t);
    await t.withIdentity(SERVICE).mutation(api.warehouseOps.undeployKit, { organizationId: ORG, projectId: "p1", userId: USER, kitId: "k1", now: NOW });
    const u = serialUnit(await memberUnits(t));
    expect(u.status).toBe("CONFIRMED");
    expect(u.prepStatus).toBe("PACKED");
  });

  test("unreturnKit: RETURNED unit → CHECKED_OUT and clears return stamps", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await co(t);
    await ci(t, "GOOD");
    await t.withIdentity(SERVICE).mutation(api.warehouseOps.unreturnKit, { organizationId: ORG, projectId: "p1", userId: USER, kitId: "k1", now: NOW });
    const u = serialUnit(await memberUnits(t));
    expect(u.status).toBe("CHECKED_OUT");
    expect(u.returnedAt).toBeUndefined();
    expect(u.returnCondition).toBeUndefined();
    expect(u.returnedQuantity).toBe(0);
  });

  test("forceReturnKit flips member unit → RETURNED", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await co(t);
    await t.withIdentity(SERVICE).mutation(api.warehouseOps.forceReturnKit, { organizationId: ORG, kitId: "k1", userId: USER, now: NOW });
    expect(serialUnit(await memberUnits(t)).status).toBe("RETURNED");
  });

  test("forceReturnAsset flips the kit member's unit → RETURNED (no split-brain)", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await co(t);
    await t.withIdentity(SERVICE).mutation(api.warehouseOps.forceReturnAsset, { organizationId: ORG, assetId: "a1", userId: USER, now: NOW });
    expect(serialUnit(await memberUnits(t)).status).toBe("RETURNED");
  });
});

describe("kit per-unit — prep tree", () => {
  test("prepKitChildren packs member units; deprepKit resets them to PENDING", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.prepKitChildren, { organizationId: ORG, projectId: "p1", parentLineItemId: "kl1", now: NOW });
    expect(serialUnit(await memberUnits(t)).prepStatus).toBe("PACKED");
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.deprepKit, { organizationId: ORG, projectId: "p1", parentLineItemId: "kl1", now: NOW });
    expect(serialUnit(await memberUnits(t)).prepStatus).toBe("PENDING");
  });

  test("deprep does not delete a RETURNED member unit (history survives)", async () => {
    const t = convexTest(schema, modules);
    await seedKit(t);
    await co(t);
    await ci(t, "GOOD");
    await t.withIdentity(SERVICE).mutation(api.checkRecordOps.deprepKit, { organizationId: ORG, projectId: "p1", parentLineItemId: "kl1", now: NOW });
    const u = serialUnit(await memberUnits(t));
    expect(u.status).toBe("RETURNED"); // untouched by deprep
  });
});

describe("kit per-unit — pre-change kit (no units)", () => {
  test("checkinKit does not throw and creates no units for a unit-less kit", async () => {
    const t = convexTest(schema, modules);
    // A kit deployed before the migration: parent + child line, CHECKED_OUT, NO units.
    await t.run(async (ctx) => {
      await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "KIT-1", name: "L", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "CHECKED_OUT", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "kl1", organizationId: ORG, projectId: "p1", kitId: "k1", type: "EQUIPMENT", status: "CHECKED_OUT", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "kc1", organizationId: ORG, projectId: "p1", parentLineItemId: "kl1", assetId: "a1", type: "EQUIPMENT", status: "CHECKED_OUT", isKitChild: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(ci(t, "GOOD")).resolves.toBeTruthy();
    expect(await memberUnits(t)).toHaveLength(0); // no unit invented on the legacy path
    expect(await assetStatus(t)).toBe("AVAILABLE"); // belt still restored the asset
  });
});
