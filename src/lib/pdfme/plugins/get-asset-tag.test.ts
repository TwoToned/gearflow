/**
 * Tests for getAssetTag — the docket / packing-list / return-sheet
 * helper that picks what to render in the "Asset Tag" column.
 *
 * Post-cutover, a deployed multi-quantity line has units, not a
 * `line.asset`. The helper must prefer the unit-tag list and degrade
 * gracefully to legacy fields for single-asset and kit-child rows.
 */

import { describe, it, expect } from "vitest";
import { getAssetTag } from "./gearflow-table";
import type { DocumentLineItem } from "../types";

function lineItem(over: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: "li-1",
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: null,
    pricingType: "PER_DAY",
    duration: 1,
    discount: null,
    lineTotal: null,
    groupName: null,
    categoryName: null,
    groupTitle: null,
    isOptional: false,
    notes: null,
    status: "CONFIRMED",
    model: null,
    asset: null,
    bulkAsset: null,
    ...over,
  };
}

describe("getAssetTag", () => {
  it("kit row → kit tag", () => {
    const li = lineItem({
      kit: { assetTag: "KIT-1", name: "Lighting Kit" },
      kitId: "k-1",
    });
    expect(getAssetTag(li, true)).toBe("KIT-1");
  });

  it("kit row with no kit tag → dash", () => {
    expect(getAssetTag(lineItem({ kitId: "k-1" }), true)).toBe("-");
  });

  it("single unit → unit's tag (no commas)", () => {
    const li = lineItem({
      quantity: 1,
      units: [
        { id: "u1", asset: { assetTag: "STAGE-001" }, bulkAsset: null, status: "CHECKED_OUT" },
      ],
    });
    expect(getAssetTag(li, false)).toBe("STAGE-001");
  });

  it("two units → comma-joined", () => {
    const li = lineItem({
      quantity: 2,
      units: [
        { id: "u1", asset: { assetTag: "MIC-001" }, bulkAsset: null, status: "CHECKED_OUT" },
        { id: "u2", asset: { assetTag: "MIC-002" }, bulkAsset: null, status: "CHECKED_OUT" },
      ],
    });
    expect(getAssetTag(li, false)).toBe("MIC-001, MIC-002");
  });

  it("more than two units → first two + '+N'", () => {
    const li = lineItem({
      quantity: 10,
      units: Array.from({ length: 10 }, (_, i) => ({
        id: `u${i}`,
        asset: { assetTag: `P2-${String(i + 1).padStart(3, "0")}` },
        bulkAsset: null,
        status: "CHECKED_OUT",
      })),
    });
    expect(getAssetTag(li, false)).toBe("P2-001, P2-002 +8");
  });

  it("falls back to legacy line.asset when no units (kit child shape)", () => {
    const li = lineItem({
      isKitChild: true,
      asset: { assetTag: "CHILD-ASSET" },
    });
    expect(getAssetTag(li, false)).toBe("CHILD-ASSET");
  });

  it("falls back to bulkAsset when no units and no asset", () => {
    const li = lineItem({
      bulkAsset: { assetTag: "BULK-CABLE" },
    });
    expect(getAssetTag(li, false)).toBe("BULK-CABLE");
  });

  it("empty units array → falls back to legacy fields", () => {
    const li = lineItem({
      units: [],
      asset: { assetTag: "ONLY-LEGACY" },
    });
    expect(getAssetTag(li, false)).toBe("ONLY-LEGACY");
  });

  it("units present but none have a tag → falls back to legacy", () => {
    const li = lineItem({
      units: [{ id: "u1", asset: null, bulkAsset: null, status: "CONFIRMED" }],
      bulkAsset: { assetTag: "FALLBACK" },
    });
    expect(getAssetTag(li, false)).toBe("FALLBACK");
  });

  it("nothing assigned anywhere → dash", () => {
    expect(getAssetTag(lineItem({}), false)).toBe("-");
  });

  it("bulk unit's bulkAsset tag also works", () => {
    const li = lineItem({
      units: [
        { id: "u1", asset: null, bulkAsset: { assetTag: "BULK-XLR" }, status: "CHECKED_OUT" },
      ],
    });
    expect(getAssetTag(li, false)).toBe("BULK-XLR");
  });
});
