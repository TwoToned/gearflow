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

async function seedBulkLine(t: T, opts: { orderedQuantity: number }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
      status: "PREPPING", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItems", {
      id: "bl", organizationId: ORG, projectId: "p1", type: "EQUIPMENT",
      status: "CONFIRMED", isKitChild: false, isOptional: false,
      bulkAssetId: "ba1", quantity: opts.orderedQuantity, sortOrder: 0,
      createdAt: NOW, updatedAt: NOW,
    });
  });
}

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
