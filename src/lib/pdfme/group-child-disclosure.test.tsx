/**
 * Integration test for group child disclosure, through the FULL client-facing
 * document pipeline (CLAUDE.md's PDF data-shape rule — this changes which rows
 * a group attaches, which is exactly the kind of change unit tests miss):
 *
 *   structureLineItems (collapse mode attaches only disclosed members)
 *     ->  QuoteDocument render  ->  pdf-parse text extraction
 *
 * The contract:
 *   1. By default a group still collapses to ONE row — nothing inside it
 *      appears. (The pre-feature behaviour, unchanged.)
 *   2. A disclosed member appears under the group row with its quantity.
 *   3. A disclosed member NEVER shows a price — not even its own line total,
 *      and not when the surrounding category is itemised. The group's bundle
 *      price is the charge.
 *   4. Undisclosed siblings stay hidden.
 *   5. A warehouse document is unaffected: it expands every member regardless,
 *      because the packers need the full list.
 */
import { describe, it, expect } from "vitest";
import { structureLineItems, type CategoryForStructuring } from "./structure-line-items";
import type { DocumentLineItem } from "./types";
import { QuoteDocument } from "@/lib/react-pdf/quote-document";
import { PackingListDocument } from "@/lib/react-pdf/packing-list-document";
import { renderPdfPages } from "@/lib/react-pdf/pdf-test-utils";
import { makeSpikeData } from "@/lib/react-pdf/fixture";

const CATEGORY = "Lighting";
const GROUP_ID = "grp-1";
const GROUP_TITLE = "Lighting Package";

function member(over: Partial<DocumentLineItem> & { id: string }): DocumentLineItem {
  return {
    description: null,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: 100,
    pricingType: "FLAT",
    duration: 1,
    discount: null,
    lineTotal: 100,
    groupName: null,
    categoryName: CATEGORY,
    groupTitle: GROUP_TITLE,
    groupId: GROUP_ID,
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

function makeScenario(disclose: string[]) {
  const rawLineItems: DocumentLineItem[] = [
    member({ id: "m-par", quantity: 24, lineTotal: 1200, model: { name: "LED Par RGBW" },
      showInGroupOnDocs: disclose.includes("m-par") || undefined }),
    member({ id: "m-mover", quantity: 8, lineTotal: 3400, model: { name: "Moving Head Spot" },
      showInGroupOnDocs: disclose.includes("m-mover") || undefined }),
    member({ id: "m-cable", quantity: 40, lineTotal: 260, model: { name: "DMX Cable 5m" },
      showInGroupOnDocs: disclose.includes("m-cable") || undefined }),
  ];

  const categories: CategoryForStructuring[] = [
    {
      id: "cat-lx", name: CATEGORY, sortOrder: 0,
      groups: [{
        id: GROUP_ID, title: GROUP_TITLE, description: null,
        quantity: 1, price: 8000, discount: null, sortOrder: 0,
      }],
    },
  ];
  return { rawLineItems, categories };
}

describe("group child disclosure — structuring", () => {
  it("attaches nothing when no member is disclosed (unchanged default)", () => {
    const { rawLineItems, categories } = makeScenario([]);
    const structured = structureLineItems(rawLineItems, categories, { expandProjectGroups: false });
    expect(structured).toHaveLength(1);
    expect(structured[0].isGroupRow).toBe(true);
    // The exact shape this row had before the feature existed.
    expect(structured[0].childLineItems).toBeUndefined();
  });

  it("attaches only the disclosed members, price-hidden", () => {
    const { rawLineItems, categories } = makeScenario(["m-par", "m-cable"]);
    const structured = structureLineItems(rawLineItems, categories, { expandProjectGroups: false });
    const children = structured[0].childLineItems!;
    expect(children.map((c) => c.id)).toEqual(["m-par", "m-cable"]);
    expect(children.every((c) => c.priceHidden)).toBe(true);
  });

  it("leaves the group's own bundle price alone", () => {
    const { rawLineItems, categories } = makeScenario(["m-par"]);
    const structured = structureLineItems(rawLineItems, categories, { expandProjectGroups: false });
    expect(structured[0].lineTotal).toBe(8000);
    expect(structured[0].priceHidden).toBeUndefined();
  });

  // Warehouse docs list every member regardless — the packers need the full
  // pick list, disclosed or not.
  it("does not change expand (warehouse) mode", () => {
    const { rawLineItems, categories } = makeScenario(["m-par"]);
    const all = structureLineItems(rawLineItems, categories, { expandProjectGroups: true });
    expect(all[0].childLineItems?.map((c) => c.id)).toEqual(["m-par", "m-mover", "m-cable"]);
    expect(all[0].childLineItems?.some((c) => c.priceHidden)).toBe(false);
  });
});

describe("group child disclosure — rendered quote", () => {
  it("lists the disclosed members under the group, with quantities and no prices", async () => {
    const { rawLineItems, categories } = makeScenario(["m-par", "m-cable"]);
    const structured = structureLineItems(rawLineItems, categories, { expandProjectGroups: false });
    const data = makeSpikeData({ line_items: structured, total_items: structured.length });
    const { fullText } = await renderPdfPages(<QuoteDocument data={data} />);

    // The group and its price still head the section.
    expect(fullText).toContain(GROUP_TITLE);
    expect(fullText).toContain("8,000");

    // Disclosed members appear, with their quantities.
    expect(fullText).toContain("LED Par RGBW");
    expect(fullText).toContain("24");
    expect(fullText).toContain("DMX Cable 5m");
    expect(fullText).toContain("40");

    // ...and never their prices.
    expect(fullText).not.toContain("1,200");
    expect(fullText).not.toContain("260");

    // The undisclosed sibling stays inside the bundle.
    expect(fullText).not.toContain("Moving Head Spot");
    expect(fullText).not.toContain("3,400");
  });

  it("still collapses to one row when nothing is disclosed", async () => {
    const { rawLineItems, categories } = makeScenario([]);
    const structured = structureLineItems(rawLineItems, categories, { expandProjectGroups: false });
    const data = makeSpikeData({ line_items: structured, total_items: structured.length });
    const { fullText } = await renderPdfPages(<QuoteDocument data={data} />);

    expect(fullText).toContain(GROUP_TITLE);
    for (const name of ["LED Par RGBW", "Moving Head Spot", "DMX Cable 5m"]) {
      expect(fullText).not.toContain(name);
    }
  });

  it("leaves the warehouse packing list listing everything", async () => {
    const { rawLineItems, categories } = makeScenario(["m-par"]);
    const structured = structureLineItems(rawLineItems, categories, { expandProjectGroups: true });
    const data = makeSpikeData({ line_items: structured, total_items: structured.length });
    const { fullText } = await renderPdfPages(<PackingListDocument data={data} />);

    for (const name of ["LED Par RGBW", "Moving Head Spot", "DMX Cable 5m"]) {
      expect(fullText).toContain(name);
    }
  });
});
