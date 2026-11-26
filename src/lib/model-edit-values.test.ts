import { describe, it, expect } from "vitest";

import { modelSchema } from "@/lib/validations/model";
import { modelToFormValues } from "./model-edit-values";

const STORED = {
  id: "m1", name: "MAC Aura", sku: "AURA-1", dailyRate: 85, weeklyRate: 300, monthlyRate: 900,
  defaultRentalPrice: 85, defaultPurchasePrice: 4000, replacementCost: 6000, salePrice: 0, saleStockQuantity: 4,
  weight: 9.5, powerDraw: 250, maintenanceIntervalDays: 90, assetType: "SERIALIZED" as const, isActive: true,
};

describe("modelToFormValues: an unchanged save keeps every stored value", () => {
  it("round-trips the rates, sale price and sale stock through the schema the save parses with", () => {
    const { id, ...parsed } = { ...modelSchema.parse(modelToFormValues(STORED)), id: STORED.id };
    expect(id).toBe("m1");
    // the pre-fix edit page left these five out of its form values, so the save cleared them
    expect(parsed).toMatchObject({ dailyRate: 85, weeklyRate: 300, monthlyRate: 900, salePrice: 0, saleStockQuantity: 4 });
    expect(parsed).toMatchObject({ defaultPurchasePrice: 4000, replacementCost: 6000, weight: 9.5, powerDraw: 250, sku: "AURA-1", maintenanceIntervalDays: 90 });
  });

  it("a blank box (\"\", what a real form submits) stays blank for EVERY numeric field, never a real 0", () => {
    const numeric = [
      "defaultRentalPrice", "dailyRate", "weeklyRate", "monthlyRate", "defaultPurchasePrice", "replacementCost",
      "salePrice", "saleStockQuantity", "weight", "powerDraw", "maintenanceIntervalDays",
    ] as const;
    const blanks = Object.fromEntries(numeric.map((k) => [k, ""]));
    const parsed = modelSchema.parse({ ...modelToFormValues({ id: "m3", name: "Blanks" }), ...blanks }) as Record<string, unknown>;
    for (const k of numeric) expect(parsed[k], k).toBeUndefined();
  });

  it("a model with no rates stays without rates (blank is blank, never a real 0)", () => {
    const parsed = modelSchema.parse(modelToFormValues({ id: "m2", name: "Bare" }));
    expect(parsed.dailyRate).toBeUndefined();
    expect(parsed.salePrice).toBeUndefined();
  });
});
