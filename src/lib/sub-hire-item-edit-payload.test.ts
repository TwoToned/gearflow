import { describe, it, expect } from "vitest";
import {
  buildSubHireItemInput,
  computeInlineSubHireItemInput,
  type SubHireItemRowLike,
} from "./sub-hire-item-edit-payload";

const baseItem: SubHireItemRowLike = {
  id: "it1",
  modelId: "mdl1",
  groupId: "grp1",
  description: "Rigging",
  quantity: 2,
  unitCost: 40,
  unitCharge: 100,
  pricingType: "PER_DAY",
  duration: 3,
  discount: 10,
  showOnQuote: true,
  showOnDocs: false,
  targetCategoryId: "cat1",
  targetGroupId: "tgrp1",
  notes: "Handle with care",
};

describe("buildSubHireItemInput", () => {
  it("seeds every field from the current item", () => {
    expect(buildSubHireItemInput(baseItem)).toEqual({
      modelId: "mdl1",
      groupId: "grp1",
      description: "Rigging",
      quantity: 2,
      unitCost: 40,
      unitCharge: 100,
      pricingType: "PER_DAY",
      duration: 3,
      discount: 10,
      showOnQuote: true,
      showOnDocs: false,
      targetCategoryId: "cat1",
      targetGroupId: "tgrp1",
      notes: "Handle with care",
    });
  });

  it("falls back to FLAT for an unrecognised pricingType and defaults missing numerics to 0/1", () => {
    const sparse: SubHireItemRowLike = { id: "it2", quantity: 1, pricingType: "BOGUS" };
    const input = buildSubHireItemInput(sparse);
    expect(input.pricingType).toBe("FLAT");
    expect(input.unitCost).toBe(0);
    expect(input.unitCharge).toBe(0);
    expect(input.duration).toBe(1);
    expect(input.discount).toBe(0);
  });
});

describe("computeInlineSubHireItemInput", () => {
  it("overrides only the patched field, leaving the rest at the item's current values", () => {
    const input = computeInlineSubHireItemInput(baseItem, { field: "unitPrice", value: 150 });
    expect(input.unitCharge).toBe(150);
    expect(input.description).toBe("Rigging");
    expect(input.discount).toBe(10);
  });

  it("maps a discountPercent patch straight onto the plain 0-100 discount field", () => {
    const input = computeInlineSubHireItemInput(baseItem, { field: "discountPercent", value: 25 });
    expect(input.discount).toBe(25);
  });

  it("clearing unitPrice (undefined) resolves to 0, not undefined — unitCharge is a required number", () => {
    const input = computeInlineSubHireItemInput(baseItem, { field: "unitPrice", value: undefined });
    expect(input.unitCharge).toBe(0);
  });

  it("an empty notes patch clears to undefined", () => {
    const input = computeInlineSubHireItemInput(baseItem, { field: "notes", value: "" });
    expect(input.notes).toBeUndefined();
  });

  it("a description patch overrides only the description", () => {
    const input = computeInlineSubHireItemInput(baseItem, { field: "description", value: "New label" });
    expect(input.description).toBe("New label");
    expect(input.unitCharge).toBe(100);
  });

  it("a quantity patch overrides only the quantity — no availability concept, allowOverbook is not a field here", () => {
    const input = computeInlineSubHireItemInput(baseItem, { field: "quantity", value: 7, allowOverbook: false });
    expect(input.quantity).toBe(7);
    expect(input.unitCharge).toBe(100);
    expect(input.discount).toBe(10);
  });
});
