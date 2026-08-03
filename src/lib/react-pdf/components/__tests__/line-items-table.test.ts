/**
 * #1152 — regression coverage for the pure decision logic in
 * line-items-table.tsx (filtering/grouping, badges, row display, cell text).
 * Mirrors gearflow-table.test.ts's convention of asserting on structured
 * data rather than rendered output — these functions are plain JS, so no
 * PDF rendering (or the coarser page-count-only smoke testing the #1151
 * spike used) is needed to exercise them.
 */
import { describe, it, expect } from "vitest";
import type { DocumentLineItem, TablePluginConfig } from "@/lib/pdfme/types";
import {
  filterAndGroupItems,
  deriveRowDisplay,
  getBadgesForItem,
  getChildBadge,
  qtyCellText,
  isCheckedForDocType,
  perUnitLabel,
  getColumnsForDocType,
  isKitParent,
  isGroupParentRow,
  isAccessoryParentRow,
} from "../line-items-table";

function makeItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: overrides.id ?? "li-1",
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

function makeConfig(overrides: Partial<TablePluginConfig> = {}): TablePluginConfig {
  return {
    documentType: "packing-list",
    documentColor: "#0d4f4f",
    showGroupHeaders: true,
    showKitChildren: true,
    showCheckboxes: true,
    showConditionColumns: false,
    showPricing: false,
    showBadges: false,
    showNotes: false,
    showPerUnitCheckboxes: false,
    showAssetTags: true,
    showCategories: true,
    showRowNumbers: false,
    filterOptional: false,
    filterByStatus: null,
    hidePricingPeriodSuffix: false,
    ...overrides,
  };
}

describe("filterAndGroupItems", () => {
  it("excludes kit children and container line items up front", () => {
    const items = [
      makeItem({ id: "parent", groupName: "A" }),
      makeItem({ id: "kit-child", isKitChild: true, groupName: "A" }),
      makeItem({ id: "container", isContainerLineItem: true, groupName: "A" }),
    ];
    const { groups } = filterAndGroupItems(items, makeConfig());
    expect(groups.get("A")?.map((i) => i.id)).toEqual(["parent"]);
  });

  it("filterOptional drops optional items", () => {
    const items = [makeItem({ id: "a", isOptional: false, groupName: "G" }), makeItem({ id: "b", isOptional: true, groupName: "G" })];
    const { groups } = filterAndGroupItems(items, makeConfig({ filterOptional: true }));
    expect(groups.get("G")?.map((i) => i.id)).toEqual(["a"]);
  });

  it("SALE lines are excluded from the return sheet regardless of status, but bypass filterByStatus elsewhere", () => {
    const saleItem = makeItem({ id: "sale", type: "SALE", status: "CONFIRMED", groupName: "G" });
    const returnSheetConfig = makeConfig({ documentType: "return-sheet", filterByStatus: ["CHECKED_OUT"] });
    const docketConfig = makeConfig({ documentType: "delivery-docket", filterByStatus: ["CHECKED_OUT"] });

    expect(filterAndGroupItems([saleItem], returnSheetConfig).groups.size).toBe(0);
    // Non-kit SALE line still respects groupName grouping on the docket path.
    expect(filterAndGroupItems([saleItem], docketConfig).groups.get("G")?.map((i) => i.id)).toEqual(["sale"]);
  });

  it("bulk items pass filterByStatus based on checkedOutQuantity, not their own status field", () => {
    const bulk = makeItem({ id: "bulk", bulkAssetId: "b1", quantity: 3, checkedOutQuantity: 0, status: "CHECKED_OUT", groupName: "G" });
    const config = makeConfig({ documentType: "delivery-docket", filterByStatus: ["CHECKED_OUT"] });
    expect(filterAndGroupItems([bulk], config).groups.size).toBe(0);

    const bulkDeployed = makeItem({ ...bulk, checkedOutQuantity: 2 });
    expect(filterAndGroupItems([bulkDeployed], config).groups.get("G")?.map((i) => i.id)).toEqual(["bulk"]);
  });

  it("a synthetic Project Group row passes filterByStatus when ANY child passes, even if its own status doesn't match", () => {
    const groupRow = makeItem({
      id: "group",
      isGroupRow: true,
      status: "DRAFT",
      groupName: "G",
      childLineItems: [makeItem({ id: "member-1", status: "CHECKED_OUT" }), makeItem({ id: "member-2", status: "DRAFT" })],
    });
    const config = makeConfig({ documentType: "delivery-docket", filterByStatus: ["CHECKED_OUT"] });
    expect(filterAndGroupItems([groupRow], config).groups.get("G")?.map((i) => i.id)).toEqual(["group"]);
  });

  it("delivery-docket promotes a kit parent's CHECKED_OUT children into a section named after the kit", () => {
    const kit = makeItem({
      id: "kit",
      kitId: "kit-1",
      kit: { assetTag: "KIT-1", name: "Lighting Kit" },
      childLineItems: [
        makeItem({ id: "child-out", isKitChild: true, status: "CHECKED_OUT" }),
        makeItem({ id: "child-pending", isKitChild: true, status: "CONFIRMED" }),
      ],
    });
    const { groups, ungroupedKey } = filterAndGroupItems([kit], makeConfig({ documentType: "delivery-docket" }));
    expect(ungroupedKey).toBe("General");
    expect(groups.get("Lighting Kit")?.map((i) => i.id)).toEqual(["child-out"]);
  });

  it("falls back to prepContainer then the doc-type ungrouped bucket when groupName is absent", () => {
    const packingListConfig = makeConfig({ documentType: "packing-list" });
    const { groups: g1, ungroupedKey: k1 } = filterAndGroupItems([makeItem({ id: "a", prepContainer: "Case 1" })], packingListConfig);
    expect(g1.get("Case 1")?.map((i) => i.id)).toEqual(["a"]);

    const { groups: g2, ungroupedKey: k2 } = filterAndGroupItems([makeItem({ id: "b" })], packingListConfig);
    expect(k2).toBe("Ungrouped");
    expect(g2.get(k2)?.map((i) => i.id)).toEqual(["b"]);
    expect(k1).toBe(k2);
  });
});

describe("row-kind detection", () => {
  it("isKitParent is true only for a kit's own row, not its children", () => {
    expect(isKitParent(makeItem({ kitId: "k1" }))).toBe(true);
    expect(isKitParent(makeItem({ kitId: "k1", isKitChild: true }))).toBe(false);
    expect(isKitParent(makeItem({}))).toBe(false);
  });

  it("isGroupParentRow requires isGroupRow AND at least one child", () => {
    expect(isGroupParentRow(makeItem({ isGroupRow: true, childLineItems: [makeItem({ id: "c" })] }))).toBe(true);
    expect(isGroupParentRow(makeItem({ isGroupRow: true, childLineItems: [] }))).toBe(false);
    expect(isGroupParentRow(makeItem({ isGroupRow: false, childLineItems: [makeItem({ id: "c" })] }))).toBe(false);
  });

  it("isAccessoryParentRow requires a non-kit, non-group item with an ACCESSORY child", () => {
    const withAccessory = makeItem({ childLineItems: [makeItem({ id: "acc", childKind: "ACCESSORY" })] });
    expect(isAccessoryParentRow(withAccessory)).toBe(true);
    expect(isAccessoryParentRow(makeItem({ kitId: "k1", childLineItems: [makeItem({ id: "acc", childKind: "ACCESSORY" })] }))).toBe(false);
    expect(isAccessoryParentRow(makeItem({ isGroupRow: true, childLineItems: [makeItem({ id: "acc", childKind: "ACCESSORY" })] }))).toBe(false);
    expect(isAccessoryParentRow(makeItem({ childLineItems: [makeItem({ id: "kit-member", childKind: "KIT" })] }))).toBe(false);
  });
});

describe("deriveRowDisplay", () => {
  it("bolds a parent row only when it has children AND showKitChildren is on", () => {
    const kit = makeItem({ kitId: "k1", childLineItems: [makeItem({ id: "c" })] });
    expect(deriveRowDisplay(kit, makeConfig({ showKitChildren: true })).bold).toBe(true);
    expect(deriveRowDisplay(kit, makeConfig({ showKitChildren: false })).bold).toBe(false);
  });

  it("shows the sub-hire line only when isSubhireIndicatorVisible allows it", () => {
    const clientDoc = makeItem({ subHireId: "sh-1", supplierName: "Acme Hire", showSubhireOnDocs: false });
    expect(deriveRowDisplay(clientDoc, makeConfig({ documentType: "quote" })).showSubhire).toBe(false);
    expect(deriveRowDisplay(clientDoc, makeConfig({ documentType: "packing-list" })).showSubhire).toBe(true);
  });
});

describe("badges", () => {
  it("stacks OVERBOOKED and REDUCED STOCK when a line has both", () => {
    const item = makeItem({ isOverbooked: true, overbookedHasOverbooked: true, overbookedHasReduced: true });
    const labels = getBadgesForItem(item, "packing-list").map((b) => b.label);
    expect(labels).toEqual(["OVERBOOKED", "REDUCED STOCK"]);
  });

  it("shows a single REDUCED STOCK badge when the item is reduced-only", () => {
    const item = makeItem({ isOverbooked: true, overbookedReducedOnly: true });
    expect(getBadgesForItem(item, "packing-list").map((b) => b.label)).toEqual(["REDUCED STOCK"]);
  });

  it("adds a SALE badge for WS11 sale lines regardless of doc type", () => {
    const item = makeItem({ type: "SALE" });
    expect(getBadgesForItem(item, "quote").map((b) => b.label)).toContain("SALE");
  });

  it("adds a SUBHIRE badge only when the sub-hire indicator is visible for this doc type", () => {
    const item = makeItem({ subHireId: "sh-1", showSubhireOnDocs: false });
    expect(getBadgesForItem(item, "quote").map((b) => b.label)).not.toContain("SUBHIRE");
    expect(getBadgesForItem(item, "packing-list").map((b) => b.label)).toContain("SUBHIRE");
  });

  it("child badges are limited to overbooked/reduced-stock — no sale/optional/subhire badge at that tier", () => {
    expect(getChildBadge(makeItem({ type: "SALE", isOptional: true, subHireId: "sh-1" }))).toBeNull();
    expect(getChildBadge(makeItem({ isOverbooked: true }))?.label).toBe("OVERBOOKED");
    expect(getChildBadge(makeItem({ isOverbooked: true, overbookedReducedOnly: true }))?.label).toBe("REDUCED STOCK");
  });
});

describe("qtyCellText", () => {
  it("shows the child count for a kit parent when showKitChildren is on", () => {
    const kit = makeItem({ kitId: "k1", childLineItems: [makeItem({ id: "a" }), makeItem({ id: "b" })] });
    expect(qtyCellText(kit, true, makeConfig({ showKitChildren: true }))).toBe("2");
  });

  it("delivery-docket: a kit parent shows its CHECKED_OUT child count even with showKitChildren off", () => {
    const kit = makeItem({
      kitId: "k1",
      childLineItems: [makeItem({ id: "a", status: "CHECKED_OUT" }), makeItem({ id: "b", status: "CONFIRMED" })],
    });
    const config = makeConfig({ documentType: "delivery-docket", showKitChildren: false });
    expect(qtyCellText(kit, true, config)).toBe("1");
  });

  it("delivery-docket: a bulk non-kit item shows checkedOutQuantity, a serialised one shows 1", () => {
    const bulk = makeItem({ bulkAssetId: "b1", quantity: 5, checkedOutQuantity: 3 });
    const serial = makeItem({ quantity: 1 });
    const config = makeConfig({ documentType: "delivery-docket", showKitChildren: false });
    expect(qtyCellText(bulk, false, config)).toBe("3");
    expect(qtyCellText(serial, false, config)).toBe("1");
  });

  it("every other doc type shows the raw quantity", () => {
    const item = makeItem({ quantity: 4 });
    expect(qtyCellText(item, false, makeConfig({ documentType: "quote" }))).toBe("4");
  });
});

describe("isCheckedForDocType", () => {
  it("only packing-list ticks a CHECKED_OUT row's checkbox", () => {
    const item = makeItem({ status: "CHECKED_OUT" });
    expect(isCheckedForDocType(item, "packing-list")).toBe(true);
    expect(isCheckedForDocType(item, "return-sheet")).toBe(false);
    expect(isCheckedForDocType(item, "delivery-docket")).toBe(false);
  });
});

describe("perUnitLabel", () => {
  it("uses 'Unit N — TAG' when the unit has a resolved asset tag", () => {
    const result = perUnitLabel({ asset: { assetTag: "AST-01" }, bulkAsset: null }, 0, "Fallback Name");
    expect(result).toEqual({ label: "Unit 1 — AST-01", tagged: true });
  });

  it("falls back to bulk asset tag, then to '{name} - N' for legacy lines with no unit data", () => {
    expect(perUnitLabel({ asset: null, bulkAsset: { assetTag: "BULK-1" } }, 2, "Fallback").label).toBe("Unit 3 — BULK-1");
    expect(perUnitLabel(undefined, 1, "Fog Machine")).toEqual({ label: "Fog Machine - 2", tagged: false });
  });
});

describe("getColumnsForDocType", () => {
  it("returns a distinct column set per doc type whose widths sum to 100%", () => {
    const docTypes: TablePluginConfig["documentType"][] = ["quote", "invoice", "packing-list", "return-sheet", "delivery-docket"];
    for (const documentType of docTypes) {
      const columns = getColumnsForDocType(makeConfig({ documentType }));
      const total = columns.reduce((sum, c) => sum + parseFloat(c.width), 0);
      expect(total).toBe(100);
    }
  });

  it("return-sheet and delivery-docket carry the columns their doc-specific features need", () => {
    expect(getColumnsForDocType(makeConfig({ documentType: "return-sheet" })).map((c) => c.key)).toContain("condition");
    expect(getColumnsForDocType(makeConfig({ documentType: "delivery-docket" })).map((c) => c.key)).toContain("received");
    expect(getColumnsForDocType(makeConfig({ documentType: "packing-list" })).map((c) => c.key)).toContain("category");
  });
});
