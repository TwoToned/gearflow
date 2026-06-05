/**
 * Full-pipeline PDF test for accessories (Phase F), per the CLAUDE.md rule that
 * data-shape changes need an integration test across the whole pipeline, not
 * just plugin-layer assertions.
 *
 * A serialised asset with permanent accessories is NOT a kit (no kitId). Its
 * accessory children are isKitChild:true + childKind:ACCESSORY. The pipeline
 * must:
 *   - filter the children out of the top-level list (they're not parents),
 *   - render them indented under the parent (gearflow-table),
 *   - reserve their height (section-renderer estimateSectionHeight) so the
 *     plugin doesn't silently tail-drop them.
 */

import { describe, it, expect } from "vitest";
import { runTablePlugin, makeLineItem } from "./test-utils";
import { getFilteredParentItems, estimateSectionHeight } from "../section-renderer";
import type { DocumentLineItem } from "../types";

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

describe("accessories — full PDF pipeline (Phase F)", () => {
  it("filters accessory children out of the top-level parent list", () => {
    const parent = lightWithAccessories();
    const data = { line_items: [parent, ...(parent.childLineItems ?? [])] } as never;
    const parents = getFilteredParentItems(data, "delivery-docket");
    const ids = parents.map((p) => p.id);
    expect(ids).toContain("parent-light");
    expect(ids).not.toContain("acc-clamp");
    expect(ids).not.toContain("acc-truecon");
  });

  it("renders the accessory rows indented under the parent", async () => {
    const parent = lightWithAccessories();
    const calls = await runTablePlugin([parent], { showKitChildren: false });
    const texts = calls.drawText.map((c) => c.text).join("\n");
    // Parent renders, AND accessories render even though showKitChildren is off
    // (accessories are inseparable from their parent).
    expect(texts).toMatch(/LED Par/);
    expect(texts).toMatch(/Safety Clamp/);
    expect(texts).toMatch(/TrueCon Tail/);

    // Accessory rows are indented further right than the parent name.
    const parentX = calls.drawText.find((c) => /LED Par/.test(c.text))!.x;
    const clampX = calls.drawText.find((c) => /Safety Clamp/.test(c.text))!.x;
    expect(clampX).toBeGreaterThan(parentX);
  });

  it("renders the accessories of a GROUPED accessory parent (group member)", async () => {
    const group = groupWithAccessoryMember();
    const calls = await runTablePlugin([group], { showKitChildren: false });
    const texts = calls.drawText.map((c) => c.text).join("\n");
    expect(texts).toMatch(/Wireless Michael/); // group header
    expect(texts).toMatch(/IMX6A Headset/); // the accessory parent (group member)
    // The bug: its accessory grandchild was missing from the PDF.
    expect(texts).toMatch(/Micon Adapter/);
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

    const calls = await runTablePlugin([group], { showPerUnitCheckboxes: true });
    const texts = calls.drawText.map((c) => c.text);
    // One battery line per EW-DX unit — not a single qty-10 row.
    const batteryUnitLines = texts.filter((t) => /^AA Battery - \d+$/.test(t));
    expect(batteryUnitLines).toHaveLength(10);
  });

  it("reserves height for a grouped accessory parent's accessories", () => {
    const section = { id: "s", type: "table", settings: { showKitChildren: true } } as never;
    const withAcc = { line_items: [groupWithAccessoryMember(true)] } as never;
    const withoutAcc = { line_items: [groupWithAccessoryMember(false)] } as never;
    const hAcc = estimateSectionHeight(section, withAcc, "packing-list");
    const hPlain = estimateSectionHeight(section, withoutAcc, "packing-list");
    expect(hAcc).toBeGreaterThan(hPlain);
  });

  it("reserves height for accessory children (no tail-drop)", () => {
    const tableSection = {
      id: "s1",
      type: "table",
      settings: { showKitChildren: true },
    } as never;
    const withAcc = { line_items: [lightWithAccessories()] } as never;
    const withoutAcc = {
      line_items: [makeLineItem({ id: "parent-light", asset: { id: "a", assetTag: "LIGHT-1" } as never, model: { name: "LED Par" } as never })],
    } as never;
    const hAcc = estimateSectionHeight(tableSection, withAcc, "delivery-docket");
    const hPlain = estimateSectionHeight(tableSection, withoutAcc, "delivery-docket");
    // The accessory parent must be taller — its two child rows are reserved.
    expect(hAcc).toBeGreaterThan(hPlain);
  });
});
