/**
 * Integration test for the category price-rollup feature, exercising the FULL
 * client-facing document pipeline the way CLAUDE.md's PDF data-shape rule
 * requires — plugin/unit coverage alone would not catch a consumer that was
 * missed:
 *
 *   structureLineItems (resolves pricingDisplay + reveal -> priceHidden)
 *     ->  filterAndGroupItems (buckets by section)
 *     ->  rollupAmountForBucket (the header's one figure)
 *     ->  QuoteDocument render  ->  pdf-parse text extraction
 *
 * The properties under test are the feature's whole contract:
 *   1. Every item in a rolled-up category still appears, with its quantity.
 *   2. None of their prices appear.
 *   3. ONE labelled subtotal appears for the section.
 *   4. A revealed line's own price DOES appear, and is still counted in that
 *      subtotal (so the section header is the category's total, not a
 *      remainder — the reason it prints with a label at all).
 *   5. An itemised category on the SAME document is completely unaffected.
 */
import { describe, it, expect } from "vitest";
import { structureLineItems, type CategoryForStructuring } from "./structure-line-items";
import type { DocumentLineItem } from "./types";
import {
  filterAndGroupItems,
  rollupAmountForBucket,
} from "@/lib/react-pdf/components/line-items-table";
import { QuoteDocument } from "@/lib/react-pdf/quote-document";
import { renderPdfPages } from "@/lib/react-pdf/pdf-test-utils";
import { makeSpikeData } from "@/lib/react-pdf/fixture";
import { ROLLUP_SUBTOTAL_LABEL } from "@/lib/category-pricing-display";

const ROLLUP_CAT = "Lighting";
const ITEMISED_CAT = "Audio";

function line(over: Partial<DocumentLineItem> & { id: string; lineTotal: number }): DocumentLineItem {
  return {
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: over.lineTotal,
    pricingType: "FLAT",
    duration: 1,
    discount: null,
    groupName: null,
    categoryName: null,
    groupTitle: null,
    isGroupRow: false,
    isOptional: false,
    notes: null,
    status: "CONFIRMED",
    model: null,
    asset: null,
    bulkAsset: null,
    ...over,
  } as DocumentLineItem;
}

/** Two categories side by side — one rolled up (with a revealed line inside
 *  it), one left itemised — so every assertion also proves the OTHER section
 *  was untouched. */
function makeScenario() {
  const rawLineItems: DocumentLineItem[] = [
    line({
      id: "li-par",
      categoryName: ROLLUP_CAT,
      quantity: 24,
      lineTotal: 1200,
      model: { name: "LED Par RGBW" },
    }),
    line({
      id: "li-mover",
      categoryName: ROLLUP_CAT,
      quantity: 8,
      lineTotal: 3400,
      model: { name: "Moving Head Spot" },
    }),
    line({
      id: "li-desk",
      categoryName: ROLLUP_CAT,
      quantity: 1,
      lineTotal: 450,
      // The per-item override: this one line prints its own price even though
      // its category rolled up.
      revealPriceInRollup: true,
      model: { name: "Lighting Console" },
    }),
    line({
      id: "li-wedge",
      categoryName: ITEMISED_CAT,
      quantity: 6,
      lineTotal: 900,
      model: { name: "Stage Wedge" },
    }),
  ];

  const categories: CategoryForStructuring[] = [
    { id: "cat-lx", name: ROLLUP_CAT, sortOrder: 0, pricingDisplay: "ROLLUP", groups: [] },
    // No `pricingDisplay` at all — a pre-feature row, which must behave
    // exactly as it always did.
    { id: "cat-au", name: ITEMISED_CAT, sortOrder: 1, groups: [] },
  ];

  const structured = structureLineItems(rawLineItems, categories, { expandProjectGroups: false });
  return { rawLineItems, categories, structured };
}

const QUOTE_CONFIG = {
  documentType: "quote" as const,
  documentColor: "#0d4f4f",
  showGroupHeaders: true,
  showKitChildren: false,
  showCheckboxes: false,
  showConditionColumns: false,
  showPricing: true,
  showBadges: false,
  showNotes: true,
  showPerUnitCheckboxes: false,
  showAssetTags: false,
  showCategories: false,
  showRowNumbers: false,
  filterOptional: false,
  filterByStatus: null,
  hidePricingPeriodSuffix: true,
};

describe("category price rollup — structuring", () => {
  it("marks the rolled-up section and hides only its unrevealed lines", () => {
    const { structured } = makeScenario();
    const byId = new Map(structured.map((i) => [i.id, i]));

    expect(byId.get("li-par")).toMatchObject({ rollupCategory: true, priceHidden: true });
    expect(byId.get("li-mover")).toMatchObject({ rollupCategory: true, priceHidden: true });
    // Revealed: still IN the section (so it counts toward the subtotal), but
    // its own price prints.
    expect(byId.get("li-desk")).toMatchObject({ rollupCategory: true, priceHidden: false });
  });

  it("leaves an itemised category completely unstamped", () => {
    const { structured } = makeScenario();
    const wedge = structured.find((i) => i.id === "li-wedge")!;
    expect(wedge.rollupCategory).toBeUndefined();
    expect(wedge.priceHidden).toBeUndefined();
  });
});

describe("category price rollup — section subtotal", () => {
  it("totals the whole section, revealed line included", () => {
    const { structured } = makeScenario();
    const { groups } = filterAndGroupItems(structured, QUOTE_CONFIG);
    // 1200 + 3400 + 450 — the revealed line is NOT excluded.
    expect(rollupAmountForBucket(groups.get(ROLLUP_CAT)!, QUOTE_CONFIG)).toBe(5050);
  });

  it("returns null for an itemised section", () => {
    const { structured } = makeScenario();
    const { groups } = filterAndGroupItems(structured, QUOTE_CONFIG);
    expect(rollupAmountForBucket(groups.get(ITEMISED_CAT)!, QUOTE_CONFIG)).toBeNull();
  });

  // A warehouse doc prints no money at all, so a rolled-up category must not
  // sprout a subtotal there.
  it("returns null when the document prints no pricing", () => {
    const { structured } = makeScenario();
    const config = { ...QUOTE_CONFIG, showPricing: false };
    const { groups } = filterAndGroupItems(structured, config);
    expect(rollupAmountForBucket(groups.get(ROLLUP_CAT)!, config)).toBeNull();
  });

  it("sums to the same grand total the itemised rendering would", () => {
    const { rawLineItems, structured } = makeScenario();
    const { groups } = filterAndGroupItems(structured, QUOTE_CONFIG);
    const sectioned =
      (rollupAmountForBucket(groups.get(ROLLUP_CAT)!, QUOTE_CONFIG) ?? 0) +
      groups.get(ITEMISED_CAT)!.reduce((sum, i) => sum + (i.lineTotal ?? 0), 0);
    expect(sectioned).toBe(rawLineItems.reduce((sum, i) => sum + i.lineTotal!, 0));
  });
});

describe("category price rollup — rendered quote", () => {
  it("shows every item, hides their prices, and prints one labelled section total", async () => {
    const { structured } = makeScenario();
    const data = makeSpikeData({ line_items: structured, total_items: structured.length });
    const { fullText } = await renderPdfPages(<QuoteDocument data={data} />);

    // 1. Every item still appears, with its quantity — the point of the feature.
    for (const name of ["LED Par RGBW", "Moving Head Spot", "Lighting Console", "Stage Wedge"]) {
      expect(fullText).toContain(name);
    }

    // 2. The hidden lines' prices are gone.
    expect(fullText).not.toContain("1,200");
    expect(fullText).not.toContain("3,400");

    // 3. One labelled section total for the rolled-up category.
    expect(fullText).toContain(ROLLUP_SUBTOTAL_LABEL);
    expect(fullText).toContain("5,050");

    // 4. The revealed line's own price prints.
    expect(fullText).toContain("450");

    // 5. The itemised category is untouched — its line price still prints, and
    //    it gets no section total of its own.
    expect(fullText).toContain("900");
    expect(fullText.match(new RegExp(ROLLUP_SUBTOTAL_LABEL, "g"))).toHaveLength(1);
  });

  it("prints every price when the same items sit in an itemised category", async () => {
    const { rawLineItems } = makeScenario();
    const structured = structureLineItems(rawLineItems, [
      { id: "cat-lx", name: ROLLUP_CAT, sortOrder: 0, pricingDisplay: "ITEMISED", groups: [] },
      { id: "cat-au", name: ITEMISED_CAT, sortOrder: 1, groups: [] },
    ], { expandProjectGroups: false });
    const data = makeSpikeData({ line_items: structured, total_items: structured.length });
    const { fullText } = await renderPdfPages(<QuoteDocument data={data} />);

    expect(fullText).toContain("1,200");
    expect(fullText).toContain("3,400");
    expect(fullText).not.toContain(ROLLUP_SUBTOTAL_LABEL);
  });
});
