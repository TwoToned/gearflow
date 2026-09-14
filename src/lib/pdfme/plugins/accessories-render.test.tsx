/**
 * Full-pipeline PDF test for accessories (Phase F), per the CLAUDE.md rule that
 * data-shape changes need an integration test across the whole pipeline, not
 * just plugin-layer assertions.
 *
 * A serialised asset with permanent accessories is NOT a kit (no kitId). Its
 * accessory children are isKitChild:true + childKind:ACCESSORY. The pipeline
 * must:
 *   - filter the children out of the top-level list (they're not parents),
 *   - render them indented under the parent (LineItemsTable),
 *   - render every accessory row so nothing silently tail-drops.
 *
 * #1157 (cleanup) — ported from the pdfme-composer pipeline
 * (`runTablePlugin`/`getFilteredParentItems`/`calculateItemHeight`, all
 * deleted with #1156's cutover) to the react-pdf pipeline that replaced it.
 * React-pdf's automatic layout removes the manual height-reservation
 * consumer entirely (see FEATUREDOCS/13-pdfs.md) — coverage here shifts from
 * "height reserved" to "actually renders", which is the property that
 * mattered.
 */

import { describe, it, expect } from "vitest";
import { filterAndGroupItems } from "@/lib/react-pdf/components/line-items-table";
import { DeliveryDocketDocument } from "@/lib/react-pdf/delivery-docket-document";
import { PackingListDocument } from "@/lib/react-pdf/packing-list-document";
import { QuoteDocument } from "@/lib/react-pdf/quote-document";
import { renderPdfPages } from "@/lib/react-pdf/pdf-test-utils";
import { makeSpikeData } from "@/lib/react-pdf/fixture";
import type { DocumentLineItem } from "../types";

/** Build a minimal DocumentLineItem with sensible defaults. Overrides win. */
function makeLineItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: overrides.id ?? "li-default",
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
    ...overrides,
  };
}

function lightWithAccessories(): DocumentLineItem {
  const clamp = makeLineItem({
    id: "acc-clamp",
    isKitChild: true,
    childKind: "ACCESSORY",
    quantity: 2,
    status: "CHECKED_OUT",
    bulkAsset: { id: "b1", assetTag: "CLAMP", model: { name: "Safety Clamp" } } as never,
    model: { name: "Safety Clamp" } as never,
    description: "2x Safety Clamp",
  });
  const trueCon = makeLineItem({
    id: "acc-truecon",
    isKitChild: true,
    childKind: "ACCESSORY",
    quantity: 1,
    status: "CHECKED_OUT",
    asset: { id: "a-tc", assetTag: "TRUECON-1" } as never,
    model: { name: "TrueCon Tail" } as never,
    description: "TrueCon Tail",
  });
  return makeLineItem({
    id: "parent-light",
    status: "CHECKED_OUT",
    asset: { id: "a-light", assetTag: "LIGHT-1" } as never,
    model: { name: "LED Par" } as never,
    description: "LED Par",
    childLineItems: [clamp, trueCon],
  });
}

/**
 * The user's shape: an accessory parent that is a GROUP MEMBER. structureLineItems
 * nests group members as the synthetic group row's childLineItems, so the accessory
 * parent becomes a child and its accessories become GRANDchildren — which the plugin
 * previously only rendered for nested kits (child.kitId), silently dropping them.
 */
function groupWithAccessoryMember(withAccessory = true): DocumentLineItem {
  const micon = makeLineItem({
    id: "acc-micon",
    isKitChild: true,
    childKind: "ACCESSORY",
    quantity: 12,
    status: "CONFIRMED",
    bulkAsset: { id: "b-mic", assetTag: "MICON", model: { name: "Micon Adapter" } } as never,
    model: { name: "Micon Adapter" } as never,
    description: "12x Micon Adapter",
  });
  const headset = makeLineItem({
    id: "member-headset",
    quantity: 12,
    status: "CONFIRMED",
    model: { name: "IMX6A Headset" } as never,
    description: "IMX6A Headset",
    childLineItems: withAccessory ? [micon] : [],
  });
  return makeLineItem({
    id: "group-wm",
    isGroupRow: true,
    quantity: 1,
    status: "CONFIRMED",
    model: { name: "Wireless Michael" } as never,
    description: "Wireless Michael",
    childLineItems: [headset],
  });
}

const DELIVERY_DOCKET_CONFIG = {
  documentType: "delivery-docket" as const,
  documentColor: "#0d4f4f",
  showGroupHeaders: true,
  showKitChildren: true,
  showCheckboxes: true,
  showConditionColumns: false,
  showPricing: false,
  showBadges: false,
  showNotes: false,
  showPerUnitCheckboxes: true,
  showAssetTags: true,
  showCategories: false,
  showRowNumbers: true,
  filterOptional: false,
  filterByStatus: ["CHECKED_OUT"],
  hidePricingPeriodSuffix: false,
};

describe("accessories — full PDF pipeline (Phase F)", () => {
  it("filters accessory children out of the top-level parent list", () => {
    const parent = lightWithAccessories();
    const { groups } = filterAndGroupItems([parent, ...(parent.childLineItems ?? [])], DELIVERY_DOCKET_CONFIG);
    const ids = [...groups.values()].flat().map((p) => p.id);
    expect(ids).toContain("parent-light");
    expect(ids).not.toContain("acc-clamp");
    expect(ids).not.toContain("acc-truecon");
  });

  it("renders the accessory rows under the parent when showKitChildren is on (warehouse docs)", async () => {
    const parent = lightWithAccessories();
    const data = makeSpikeData({ line_items: [parent], total_items: 1 });
    const { fullText } = await renderPdfPages(<DeliveryDocketDocument data={data} />);

    expect(fullText).toMatch(/LED Par/);
    expect(fullText).toMatch(/Safety Clamp/);
    expect(fullText).toMatch(/TrueCon Tail/);

    // Accessory rows render after (below) the parent.
    const parentIdx = fullText.search(/LED Par/);
    const clampIdx = fullText.search(/Safety Clamp/);
    expect(clampIdx).toBeGreaterThan(parentIdx);
  });

  it("hides accessory rows when showKitChildren is off (client-facing quote/invoice)", async () => {
    const parent = lightWithAccessories();
    const data = makeSpikeData({ line_items: [parent], total_items: 1 });
    const { fullText } = await renderPdfPages(<QuoteDocument data={data} />);

    // Parent still renders — only its exploded children are suppressed.
    expect(fullText).toMatch(/LED Par/);
    expect(fullText).not.toMatch(/Safety Clamp/);
    expect(fullText).not.toMatch(/TrueCon Tail/);
  });

  it("renders the accessories of a GROUPED accessory parent (group member) when showKitChildren is on", async () => {
    const group = groupWithAccessoryMember();
    const data = makeSpikeData({ line_items: [group], total_items: 1 });
    const { fullText } = await renderPdfPages(<PackingListDocument data={data} />);

    expect(fullText).toMatch(/Wireless Michael/); // group header
    expect(fullText).toMatch(/IMX6A Headset/); // the accessory parent (group member)
    // The bug: its accessory grandchild was missing from the PDF.
    expect(fullText).toMatch(/Micon Adapter/);
  });

  it("expands an accessory per unit on a packing list (10x EW-DX → 10 battery lines)", async () => {
    // EW-DX (qty 10) is a group member; its battery accessory is a grandchild.
    const battery = makeLineItem({
      id: "acc-batt",
      isKitChild: true,
      childKind: "ACCESSORY",
      quantity: 10,
      status: "CONFIRMED",
      bulkAsset: { id: "b", assetTag: "TTP00099", model: { name: "AA Battery" } } as never,
      model: { name: "AA Battery" } as never,
      description: "AA Battery",
    });
    const ewdx = makeLineItem({
      id: "ewdx",
      quantity: 10,
      status: "CONFIRMED",
      model: { name: "EW-DX SK" } as never,
      description: "EW-DX SK",
      childLineItems: [battery],
    });
    const group = makeLineItem({
      id: "group-wm",
      isGroupRow: true,
      quantity: 1,
      status: "CONFIRMED",
      model: { name: "Wireless Michael" } as never,
      childLineItems: [ewdx],
    });

    const data = makeSpikeData({ line_items: [group], total_items: 1 });
    const { fullText } = await renderPdfPages(<PackingListDocument data={data} />);
    // One battery line per EW-DX unit — not a single qty-10 row.
    const batteryUnitLines = fullText.match(/AA Battery - \d+/g) ?? [];
    expect(batteryUnitLines).toHaveLength(10);
  });

  it("renders every accessory-bearing row without dropping the accessory-less control (no tail-drop)", async () => {
    const withAcc = makeSpikeData({ line_items: [groupWithAccessoryMember(true)], total_items: 1 });
    const withoutAcc = makeSpikeData({ line_items: [groupWithAccessoryMember(false)], total_items: 1 });

    const rendered = await renderPdfPages(<PackingListDocument data={withAcc} />);
    const renderedPlain = await renderPdfPages(<PackingListDocument data={withoutAcc} />);

    expect(rendered.fullText).toContain("Micon Adapter");
    expect(renderedPlain.fullText).not.toContain("Micon Adapter");
    expect(rendered.fullText).toContain("IMX6A Headset");
    expect(renderedPlain.fullText).toContain("IMX6A Headset");
  });
});
