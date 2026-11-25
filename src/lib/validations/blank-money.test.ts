import { describe, it, expect } from "vitest";

import { assetSchema, bulkAssetCreateSchema, bulkAssetSchema } from "./asset";
import { modelSchema } from "./model";

// UX Phase 12 (§9d.4, §9e.3): a blank optional money box is blank, never a real $0.
describe("blank money stays blank", () => {
  it("model rates, costs, weight and power", () => {
    const m = modelSchema.parse({
      name: "MAC Aura",
      dailyRate: "", weeklyRate: "", monthlyRate: "", defaultRentalPrice: "",
      defaultPurchasePrice: "", replacementCost: "", salePrice: "", weight: "", powerDraw: "",
    });
    for (const k of ["dailyRate", "weeklyRate", "monthlyRate", "defaultRentalPrice", "defaultPurchasePrice", "replacementCost", "salePrice", "weight", "powerDraw"] as const) {
      expect(m[k], k).toBeUndefined();
    }
  });

  it("a typed 0 is a real price; a negative or non-numeric rate is rejected", () => {
    expect(modelSchema.parse({ name: "X", dailyRate: "0" }).dailyRate).toBe(0);
    expect(modelSchema.parse({ name: "X", dailyRate: "85.5" }).dailyRate).toBe(85.5);
    expect(modelSchema.safeParse({ name: "X", dailyRate: "-1" }).success).toBe(false);
    expect(modelSchema.safeParse({ name: "X", dailyRate: "abc" }).success).toBe(false);
    expect(modelSchema.safeParse({ name: "X", powerDraw: "1.5" }).success).toBe(false);
  });

  it("a warranty can't end before the purchase; bulk stock is created with at least 1", () => {
    const base = { modelId: "m", assetTag: "A" };
    expect(assetSchema.safeParse({ ...base, purchaseDate: "2026-06-01", warrantyExpiry: "2026-05-31" }).success).toBe(false);
    expect(assetSchema.safeParse({ ...base, purchaseDate: "2026-06-01", warrantyExpiry: "2026-06-01" }).success).toBe(true);
    expect(assetSchema.safeParse({ ...base, warrantyExpiry: "2026-05-31" }).success).toBe(true);
    expect(bulkAssetCreateSchema.safeParse({ modelId: "m", assetTag: "B", totalQuantity: 0 }).success).toBe(false);
    expect(bulkAssetCreateSchema.safeParse({ modelId: "m", assetTag: "B", totalQuantity: "3" }).success).toBe(true);
    expect(bulkAssetSchema.safeParse({ modelId: "m", assetTag: "B", totalQuantity: 0 }).success).toBe(true);
  });

  it("asset purchase price and bulk price per unit", () => {
    expect(assetSchema.parse({ modelId: "m", assetTag: "A", purchasePrice: "" }).purchasePrice).toBeUndefined();
    expect(assetSchema.parse({ modelId: "m", assetTag: "A", purchasePrice: "0" }).purchasePrice).toBe(0);
    expect(bulkAssetSchema.parse({ modelId: "m", assetTag: "B", purchasePricePerUnit: "" }).purchasePricePerUnit).toBeUndefined();
    expect(bulkAssetSchema.parse({ modelId: "m", assetTag: "B", purchasePricePerUnit: "3" }).purchasePricePerUnit).toBe(3);
    expect(bulkAssetSchema.safeParse({ modelId: "m", assetTag: "B", purchasePricePerUnit: "-3" }).success).toBe(false);
  });
});
