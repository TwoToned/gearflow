/**
 * Unit tests for the stocktake Zod schemas. These gate every stocktake
 * server action's input — locking them prevents a loosened schema from
 * silently letting bad data into the inventory-mutating actions.
 */

import { describe, it, expect } from "vitest";
import {
  createStocktakeSchema,
  updateStocktakeSchema,
  scanItemSchema,
  updateBulkCountSchema,
  resolveDiscrepancySchema,
  bulkResolveSchema,
} from "./stocktake";

describe("createStocktakeSchema", () => {
  it("accepts a valid FULL-scope stocktake", () => {
    const r = createStocktakeSchema.safeParse({
      name: "Q2 count",
      locationId: "loc_1",
      scope: "FULL",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a CATEGORY scope with a categoryId", () => {
    const r = createStocktakeSchema.safeParse({
      name: "Cables only",
      locationId: "loc_1",
      scope: "CATEGORY",
      categoryId: "cat_1",
      notes: "annual",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const r = createStocktakeSchema.safeParse({ name: "", locationId: "loc_1", scope: "FULL" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing locationId", () => {
    const r = createStocktakeSchema.safeParse({ name: "x", locationId: "", scope: "FULL" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown scope", () => {
    const r = createStocktakeSchema.safeParse({ name: "x", locationId: "loc_1", scope: "PARTIAL" });
    expect(r.success).toBe(false);
  });

  it("rejects a name over 200 chars", () => {
    const r = createStocktakeSchema.safeParse({
      name: "x".repeat(201),
      locationId: "loc_1",
      scope: "FULL",
    });
    expect(r.success).toBe(false);
  });

  it("updateStocktakeSchema mirrors createStocktakeSchema", () => {
    const valid = { name: "x", locationId: "loc_1", scope: "SPOT_CHECK" as const };
    expect(updateStocktakeSchema.safeParse(valid).success).toBe(true);
  });
});

describe("scanItemSchema", () => {
  it("accepts a stocktakeId + assetTag", () => {
    expect(scanItemSchema.safeParse({ stocktakeId: "st_1", assetTag: "TAG-1" }).success).toBe(true);
  });

  it("rejects an empty assetTag", () => {
    expect(scanItemSchema.safeParse({ stocktakeId: "st_1", assetTag: "" }).success).toBe(false);
  });

  it("rejects an assetTag over 128 chars", () => {
    expect(
      scanItemSchema.safeParse({ stocktakeId: "st_1", assetTag: "x".repeat(129) }).success,
    ).toBe(false);
  });
});

describe("updateBulkCountSchema", () => {
  it("accepts a non-negative integer quantity", () => {
    expect(updateBulkCountSchema.safeParse({ itemId: "i_1", quantity: 0 }).success).toBe(true);
    expect(updateBulkCountSchema.safeParse({ itemId: "i_1", quantity: 42 }).success).toBe(true);
  });

  it("coerces a numeric string", () => {
    const r = updateBulkCountSchema.safeParse({ itemId: "i_1", quantity: "17" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.quantity).toBe(17);
  });

  it("rejects a negative quantity", () => {
    expect(updateBulkCountSchema.safeParse({ itemId: "i_1", quantity: -1 }).success).toBe(false);
  });

  it("rejects a fractional quantity", () => {
    expect(updateBulkCountSchema.safeParse({ itemId: "i_1", quantity: 2.5 }).success).toBe(false);
  });
});

describe("resolveDiscrepancySchema", () => {
  it.each(["MARK_LOST", "UPDATE_LOCATION", "ADJUST_QUANTITY", "IGNORE"] as const)(
    "accepts action %s",
    (action) => {
      expect(resolveDiscrepancySchema.safeParse({ itemId: "i_1", action }).success).toBe(true);
    },
  );

  it("rejects an unknown action", () => {
    expect(
      resolveDiscrepancySchema.safeParse({ itemId: "i_1", action: "DELETE" }).success,
    ).toBe(false);
  });

  it("rejects a note over 500 chars", () => {
    expect(
      resolveDiscrepancySchema.safeParse({
        itemId: "i_1",
        action: "IGNORE",
        note: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("bulkResolveSchema", () => {
  it.each(["MARK_ALL_MISSING_LOST", "IGNORE_ALL_MISSING"] as const)(
    "accepts action %s",
    (action) => {
      expect(bulkResolveSchema.safeParse({ stocktakeId: "st_1", action }).success).toBe(true);
    },
  );

  it("rejects an unknown action", () => {
    expect(
      bulkResolveSchema.safeParse({ stocktakeId: "st_1", action: "MARK_ALL_FOUND" }).success,
    ).toBe(false);
  });

  it("rejects a missing stocktakeId", () => {
    expect(
      bulkResolveSchema.safeParse({ stocktakeId: "", action: "IGNORE_ALL_MISSING" }).success,
    ).toBe(false);
  });
});
