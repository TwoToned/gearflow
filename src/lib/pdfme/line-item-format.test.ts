/**
 * #1157 (cleanup) — tests for the pure `DocumentLineItem` formatting helpers
 * extracted to `line-item-format.ts` from the deleted `plugins/gearflow-table.ts`.
 *
 * Ported from (now-deleted) `plugins/get-asset-tag.test.ts` (verbatim, just the
 * import path changed) and the `breakdownLabel`/`discountCellText`-relevant
 * assertions out of `plugins/gearflow-table.test.ts`'s "priceBreakdown rendering
 * (#943)" and "per-item Discount column (quote/invoice)" describe blocks — those
 * used to assert on `page.drawText` calls captured by the pdf-lib plugin harness;
 * here they call the extracted pure functions directly, which is a strictly
 * tighter test of the same behavior (no pdf-lib draw plumbing in the way).
 */
import { describe, it, expect } from "vitest";
import { discountCellText, breakdownLabel, isSubhireIndicatorVisible, getAssetTag } from "./line-item-format";
import type { DocumentLineItem, TablePluginConfig } from "./types";

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

const DEFAULT_CONFIG: TablePluginConfig = {
  documentType: "packing-list",
  documentColor: "#0d4f4f",
  showGroupHeaders: true,
  showKitChildren: true,
  showCheckboxes: true,
  showConditionColumns: false,
  showPricing: false,
  showBadges: true,
  showNotes: false,
  showPerUnitCheckboxes: false,
  showAssetTags: true,
  showCategories: true,
  showRowNumbers: false,
  filterOptional: false,
  filterByStatus: null,
  hidePricingPeriodSuffix: false,
};

function config(over: Partial<TablePluginConfig> = {}): TablePluginConfig {
  return { ...DEFAULT_CONFIG, ...over };
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

  it("kit child WITH a unit → the unit's tag, identical to the legacy line.asset (migration is render-neutral)", () => {
    const li = lineItem({
      isKitChild: true,
      quantity: 1,
      asset: { assetTag: "CHILD-ASSET" },
      units: [{ id: "u1", asset: { assetTag: "CHILD-ASSET" }, bulkAsset: null, status: "CHECKED_OUT" }],
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

  it("bulk line with many units sharing one tag → the tag alone, not duplicated + overflow", () => {
    const li = lineItem({
      quantity: 10,
      units: Array.from({ length: 10 }, (_, i) => ({
        id: `u${i}`,
        asset: null,
        bulkAsset: { assetTag: "TTP00099" },
        status: "CHECKED_OUT",
      })),
    });
    expect(getAssetTag(li, false)).toBe("TTP00099");
  });

  it("mixed units where some share a tag → dedupes before the '+N' count", () => {
    const li = lineItem({
      quantity: 4,
      units: [
        { id: "u0", asset: { assetTag: "TAG-A" }, bulkAsset: null, status: "CHECKED_OUT" },
        { id: "u1", asset: { assetTag: "TAG-A" }, bulkAsset: null, status: "CHECKED_OUT" },
        { id: "u2", asset: { assetTag: "TAG-B" }, bulkAsset: null, status: "CHECKED_OUT" },
        { id: "u3", asset: { assetTag: "TAG-C" }, bulkAsset: null, status: "CHECKED_OUT" },
      ],
    });
    expect(getAssetTag(li, false)).toBe("TAG-A, TAG-B +1");
  });
});

describe("breakdownLabel (#943)", () => {
  it("formats a single-week breakdown", () => {
    const item = lineItem({
      priceBreakdown: JSON.stringify({ weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: false }),
    });
    expect(breakdownLabel(item, config({ showPricing: true }))).toBe("1 wk @ $100.00");
  });

  it("formats the capped-week label distinctly from the uncapped breakdown", () => {
    const item = lineItem({
      priceBreakdown: JSON.stringify({ weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: true }),
    });
    expect(breakdownLabel(item, config({ showPricing: true }))).toBe("charged as 1 wk (capped)");
  });

  it("shows both weeks-and-days terms when both are non-zero", () => {
    const item = lineItem({
      priceBreakdown: JSON.stringify({ weeks: 2, days: 3, weeklyRate: 50, dailyRate: 10, capped: false }),
    });
    expect(breakdownLabel(item, config({ showPricing: true }))).toBe("2 wk @ $50.00 + 3 d @ $10.00");
  });

  it("returns '' when showPricing is off, even with a stored breakdown", () => {
    const item = lineItem({
      priceBreakdown: JSON.stringify({ weeks: 1, days: 0, weeklyRate: 100, dailyRate: 20, capped: false }),
    });
    expect(breakdownLabel(item, config({ showPricing: false }))).toBe("");
  });

  it("returns '' for a manually-priced line (no priceBreakdown stored)", () => {
    const item = lineItem({ unitPrice: 15 });
    expect(breakdownLabel(item, config({ showPricing: true }))).toBe("");
  });

  it("returns '' for malformed priceBreakdown JSON rather than throwing", () => {
    const item = lineItem({ priceBreakdown: "{not valid json" });
    expect(() => breakdownLabel(item, config({ showPricing: true }))).not.toThrow();
    expect(breakdownLabel(item, config({ showPricing: true }))).toBe("");
  });
});

describe("discountCellText (#1012)", () => {
  it("renders the line's discount as a negative amount", () => {
    const item = lineItem({ unitPrice: 20, lineTotal: 15, discount: 5 });
    expect(discountCellText(item)).toBe("-$5.00");
  });

  it("renders '-' when the line has no discount", () => {
    const item = lineItem({ unitPrice: 20, lineTotal: 20, discount: null });
    expect(discountCellText(item)).toBe("-");
  });

  it("renders a percentage when the line was discounted in % mode", () => {
    // 30 is 15% of the 200.00 gross (unitPrice 20 * quantity 5 * duration 2).
    const item = lineItem({
      unitPrice: 20,
      quantity: 5,
      duration: 2,
      discount: 30,
      discountMode: "%",
      lineTotal: 170,
    });
    expect(discountCellText(item)).toBe("-15%");
  });

  it("falls back to the dollar amount for a pre-#1012 row with no stored mode", () => {
    const item = lineItem({ unitPrice: 20, quantity: 5, duration: 2, discount: 30, lineTotal: 170 });
    expect(discountCellText(item)).toBe("-$30.00");
  });

  it("falls back to the dollar amount when a % row has no gross to measure against", () => {
    const item = lineItem({ unitPrice: 0, quantity: 1, duration: 1, discount: 5, discountMode: "%", lineTotal: 0 });
    expect(discountCellText(item)).toBe("-$5.00");
  });

  it("renders a kit child's % discount as a percentage too", () => {
    const child = lineItem({
      id: "child-1",
      isKitChild: true,
      unitPrice: 50,
      quantity: 2,
      duration: 1,
      discount: 20,
      discountMode: "%",
      lineTotal: 80,
    });
    expect(discountCellText(child)).toBe("-20%");
  });
});

describe("isSubhireIndicatorVisible", () => {
  it("is false when the line has no sub-hire", () => {
    expect(isSubhireIndicatorVisible(lineItem({}), "quote")).toBe(false);
  });

  it("is always true on internal docs (packing-list/return-sheet/delivery-docket)", () => {
    const item = lineItem({ subHireId: "sh-1", showSubhireOnDocs: false });
    expect(isSubhireIndicatorVisible(item, "packing-list")).toBe(true);
    expect(isSubhireIndicatorVisible(item, "return-sheet")).toBe(true);
    expect(isSubhireIndicatorVisible(item, "delivery-docket")).toBe(true);
  });

  it("on client-facing docs (quote/invoice), gated by showSubhireOnDocs", () => {
    const hidden = lineItem({ subHireId: "sh-1", showSubhireOnDocs: false });
    const shown = lineItem({ subHireId: "sh-1", showSubhireOnDocs: true });
    expect(isSubhireIndicatorVisible(hidden, "quote")).toBe(false);
    expect(isSubhireIndicatorVisible(shown, "quote")).toBe(true);
    expect(isSubhireIndicatorVisible(hidden, "invoice")).toBe(false);
    expect(isSubhireIndicatorVisible(shown, "invoice")).toBe(true);
  });
});
