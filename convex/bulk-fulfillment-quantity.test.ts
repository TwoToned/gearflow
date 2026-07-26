// @vitest-environment node
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { prepUnit, returnLineUnits } from "./lib/fulfillment";

type T = TestConvex<typeof schema>;

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;

/**
 * Regression for the bulk-asset quantity bug (issue #8): prep must NOT collapse a
 * bulk line's packed quantity to 1, and a return must default to the full remaining
 * checked-out quantity (not 1, which forced "click return 16 times").
 */

async function seedBulkLine(t: T, opts: { orderedQuantity: number; availableQuantity?: number; isKitChild?: boolean }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
      status: "PREPPING", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "Cable", assetType: "BULK", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("bulkAssets", {
      id: "ba1", organizationId: ORG, assetTag: "CABLE", modelId: "m1", availableQuantity: opts.availableQuantity ?? 20,
    });
    await ctx.db.insert("projectLineItems", {
      id: "bl", organizationId: ORG, projectId: "p1", type: "EQUIPMENT",
      status: "CONFIRMED", isKitChild: opts.isKitChild ?? false, isOptional: false,
      bulkAssetId: "ba1", quantity: opts.orderedQuantity, sortOrder: 0,
      createdAt: NOW, updatedAt: NOW,
    });
  });
}

const readBulkAvailable = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", "ba1")).unique())?.availableQuantity);

const readBulkUnit = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", "bl")).collect())
      .find((u) => u.bulkAssetId === "ba1"),
  );

describe("bulk fulfillment quantity", () => {
  test("prep accumulates to the full quantity even when expanded into qty-1 calls", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 16 });

    // Simulate the OLD client behaviour: 16 separate qty-1 prep calls. With the fix
    // these accumulate onto the single (line, bulkAsset) unit instead of overwriting
    // it to 1 (last-write-wins), so the unit ends at 16 — not 1.
    for (let i = 0; i < 16; i++) {
      await t.run((ctx) =>
        prepUnit(ctx, { organizationId: ORG, lineItemId: "bl", bulkAssetId: "ba1", quantity: 1 }),
      );
    }

    const unit = await readBulkUnit(t);
    expect(unit?.quantity).toBe(16);
    expect(unit?.prepStatus).toBe("PACKED");
  });

  test("prep caps accumulation at the line's ordered quantity", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 10 });
    // One aggregate prep of the full quantity.
    await t.run((ctx) =>
      prepUnit(ctx, { organizationId: ORG, lineItemId: "bl", bulkAssetId: "ba1", quantity: 10 }),
    );
    // A stray extra prep must not push it past the ordered quantity.
    await t.run((ctx) =>
      prepUnit(ctx, { organizationId: ORG, lineItemId: "bl", bulkAssetId: "ba1", quantity: 5 }),
    );
    const unit = await readBulkUnit(t);
    expect(unit?.quantity).toBe(10);
  });

  test("return with no explicit quantity returns the FULL remaining checked-out quantity", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 16 });
    // A bulk unit deployed with 16 on the job.
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "bl", ordinal: 1,
        bulkAssetId: "ba1", quantity: 16, returnedQuantity: 0, status: "CHECKED_OUT",
        createdAt: NOW, updatedAt: NOW,
      });
    });

    const result = await t.run((ctx) =>
      returnLineUnits(ctx, {
        organizationId: ORG, projectId: "p1", lineItemId: "bl", bulkAssetId: "ba1",
        returnCondition: "GOOD", userId: "user_1", defaultLocationId: null,
        // quantity intentionally omitted — must default to the full remaining 16.
      }),
    );

    expect(result.unitsFlipped).toBeGreaterThan(0);
    const unit = await readBulkUnit(t);
    expect(unit?.returnedQuantity).toBe(16);
    expect(unit?.status).toBe("RETURNED");
  });

  test("return still honours an explicit partial quantity", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 16 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "bl", ordinal: 1,
        bulkAssetId: "ba1", quantity: 16, returnedQuantity: 0, status: "CHECKED_OUT",
        createdAt: NOW, updatedAt: NOW,
      });
    });
    await t.run((ctx) =>
      returnLineUnits(ctx, {
        organizationId: ORG, projectId: "p1", lineItemId: "bl", bulkAssetId: "ba1",
        returnCondition: "GOOD", userId: "user_1", defaultLocationId: null, quantity: 5,
      }),
    );
    const unit = await readBulkUnit(t);
    expect(unit?.returnedQuantity).toBe(5);
    expect(unit?.status).toBe("CHECKED_OUT"); // not fully returned
  });
});

/**
 * Regression for issue #801 (#2): a bulk asset checked out/returned STANDALONE
 * (not inside a kit) never touched `bulkAssets.availableQuantity` — only the kit
 * checkout/checkin path (`collectKitBulkAdjustments`) and DEDICATED-mode
 * accessory attach/detach did. So the registry's "Available" column drifted
 * arbitrarily out of sync with real deployment for any bulk stock only ever
 * used standalone.
 */
describe("standalone bulk checkout/checkin maintains bulkAssets.availableQuantity", () => {
  test("checkOutBulkItem (via checkoutItemsCore) decrements available stock", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 6, availableQuantity: 20 });
    const { checkoutItemsCore } = await import("./warehouseOps");
    await t.run((ctx) =>
      checkoutItemsCore(ctx, {
        organizationId: ORG, projectId: "p1", userId: "user_1",
        items: [{ lineItemId: "bl", quantity: 6 }], includeAccessories: false, now: NOW,
      }),
    );
    expect(await readBulkAvailable(t)).toBe(14);
    const unit = await readBulkUnit(t);
    expect(unit?.status).toBe("CHECKED_OUT");
    expect(unit?.quantity).toBe(6);
  });

  test("a repeat checkout call for the same total quantity does not double-consume stock", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 6, availableQuantity: 20 });
    const { checkoutItemsCore } = await import("./warehouseOps");
    const doCheckout = () =>
      t.run((ctx) =>
        checkoutItemsCore(ctx, {
          organizationId: ORG, projectId: "p1", userId: "user_1",
          items: [{ lineItemId: "bl", quantity: 6 }], includeAccessories: false, now: NOW,
        }),
      );
    await doCheckout();
    await doCheckout();
    expect(await readBulkAvailable(t)).toBe(14);
  });

  test("returnLineUnits (standalone bulk check-in) restores available stock", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 16, availableQuantity: 4 });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "bl", ordinal: 1,
        bulkAssetId: "ba1", quantity: 16, returnedQuantity: 0, status: "CHECKED_OUT",
        createdAt: NOW, updatedAt: NOW,
      });
    });
    await t.run((ctx) =>
      returnLineUnits(ctx, {
        organizationId: ORG, projectId: "p1", lineItemId: "bl", bulkAssetId: "ba1",
        returnCondition: "GOOD", userId: "user_1", defaultLocationId: null, quantity: 10,
      }),
    );
    expect(await readBulkAvailable(t)).toBe(14);
  });

  test("a full standalone checkout-then-return round trip leaves availableQuantity unchanged", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 8, availableQuantity: 20 });
    const { checkoutItemsCore } = await import("./warehouseOps");
    await t.run((ctx) =>
      checkoutItemsCore(ctx, {
        organizationId: ORG, projectId: "p1", userId: "user_1",
        items: [{ lineItemId: "bl", quantity: 8 }], includeAccessories: false, now: NOW,
      }),
    );
    expect(await readBulkAvailable(t)).toBe(12);
    await t.run((ctx) =>
      returnLineUnits(ctx, {
        organizationId: ORG, projectId: "p1", lineItemId: "bl", bulkAssetId: "ba1",
        returnCondition: "GOOD", userId: "user_1", defaultLocationId: null,
      }),
    );
    expect(await readBulkAvailable(t)).toBe(20);
  });

  test("kit-child bulk lines are NOT double-adjusted by the standalone path (kits own their own adjustment)", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 6, availableQuantity: 20, isKitChild: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "bl", ordinal: 1,
        bulkAssetId: "ba1", quantity: 6, returnedQuantity: 0, status: "CHECKED_OUT",
        createdAt: NOW, updatedAt: NOW,
      });
    });
    await t.run((ctx) =>
      returnLineUnits(ctx, {
        organizationId: ORG, projectId: "p1", lineItemId: "bl", bulkAssetId: "ba1",
        returnCondition: "GOOD", userId: "user_1", defaultLocationId: null,
      }),
    );
    // isKitChild lines are the kit's own bulk-adjustment responsibility
    // (collectKitBulkAdjustments off kitBulkItems) — the standalone path must
    // stay out of the way, or a kit checkin would double-release stock.
    expect(await readBulkAvailable(t)).toBe(20);
  });
});

/**
 * Move-back parity for issue #801 (#2): the forward checkout/checkin mutations
 * now maintain `bulkAssets.availableQuantity` for standalone lines, so their
 * "Move to …" reverses (undeployItems / unreturnItems) must mirror kit
 * move-back's documented "+1"/"-1" (FEATUREDOCS/12-warehouse.md) — otherwise a
 * misclick-correction workflow would leak or double-consume shelf stock.
 */
describe("standalone bulk move-back maintains bulkAssets.availableQuantity", () => {
  test("undeployItems (Deployed → Prepped) releases stock back to the shelf", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 6, availableQuantity: 14 }); // 6 already deployed
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "bl", ordinal: 1,
        bulkAssetId: "ba1", quantity: 6, returnedQuantity: 0, status: "CHECKED_OUT",
        createdAt: NOW, updatedAt: NOW,
      });
    });
    const { undeployItemsCore } = await import("./warehouseOps");
    await t.run((ctx) =>
      undeployItemsCore(ctx, { organizationId: ORG, projectId: "p1", userId: "user_1", items: [{ lineItemId: "bl" }], now: NOW }),
    );
    expect(await readBulkAvailable(t)).toBe(20);
    const unit = await readBulkUnit(t);
    expect(unit?.status).toBe("CONFIRMED");
  });

  test("unreturnItems (Returned → Deployed) re-consumes stock from the shelf", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 6, availableQuantity: 20 }); // fully returned already
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "bl", ordinal: 1,
        bulkAssetId: "ba1", quantity: 6, returnedQuantity: 6, status: "RETURNED",
        createdAt: NOW, updatedAt: NOW,
      });
    });
    const { unreturnItemsCore } = await import("./warehouseOps");
    await t.run((ctx) =>
      unreturnItemsCore(ctx, { organizationId: ORG, projectId: "p1", userId: "user_1", items: [{ lineItemId: "bl" }], now: NOW }),
    );
    expect(await readBulkAvailable(t)).toBe(14);
    const unit = await readBulkUnit(t);
    expect(unit?.status).toBe("CHECKED_OUT");
  });

  test("kit-child bulk lines are NOT double-adjusted by undeployItems move-back", async () => {
    const t = convexTest(schema, modules);
    await seedBulkLine(t, { orderedQuantity: 6, availableQuantity: 20, isKitChild: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "bl", ordinal: 1,
        bulkAssetId: "ba1", quantity: 6, returnedQuantity: 0, status: "CHECKED_OUT",
        createdAt: NOW, updatedAt: NOW,
      });
    });
    const { undeployItemsCore } = await import("./warehouseOps");
    await t.run((ctx) =>
      undeployItemsCore(ctx, { organizationId: ORG, projectId: "p1", userId: "user_1", items: [{ lineItemId: "bl" }], now: NOW }),
    );
    expect(await readBulkAvailable(t)).toBe(20);
  });
});
