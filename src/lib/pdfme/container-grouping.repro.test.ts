/**
 * Phase 3a regression (gearflow#1300, tracking #1296) — was the phase 0
 * repro (gearflow#1297) pinning defect #2 from
 * docs/designs/packing-containers-manifest.md §1.5 ("containers never
 * print"): `structureLineItems` stamped `groupName` (the category, or
 * `[Kit] <name>`, or "Uncategorized") on every row it emitted, and the
 * downstream table (`filterAndGroupItems`, line-items-table.tsx) bucketed by
 * `item.groupName || item.prepContainer`. Since `groupName` was always
 * truthy, the category always won and `prepContainer` was dead — two items
 * packed into the same case, in different categories, never surfaced as one
 * container section on any PDF.
 *
 * Phase 3a's `byContainer` structuring mode (structure-line-items-by-
 * container.ts, exercised here through `structureLineItems`'s
 * `StructureOptions.byContainer`) fixes it — this file is now the real
 * regression test. See structure-line-items-by-container.test.ts for the
 * full behaviour suite (nesting, splits, kits, Loose).
 */
import { describe, test, expect } from "vitest";
import { structureLineItems, type ContainerForStructuring } from "./structure-line-items";
import { filterAndGroupItems } from "@/lib/react-pdf/components/line-items-table";
import type { DocumentLineItem, TablePluginConfig } from "./types";

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

function makeLineItem(overrides: Partial<DocumentLineItem>): DocumentLineItem {
  return {
    id: "li-default",
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
    status: "CHECKED_OUT",
    model: null,
    asset: null,
    bulkAsset: null,
    ...overrides,
  };
}

describe("container grouping (defect #2, §1.5) — fixed", () => {
  test("two items packed into the same case, from different categories, surface under one container section", () => {
    const containers: ContainerForStructuring[] = [{ id: "c1", kind: "CUSTOM", label: "Case 12", sortOrder: 0 }];
    const raw = [
      makeLineItem({
        id: "a", description: "Par Can", categoryName: "Lighting",
        units: [{ id: "u-a", asset: { assetTag: "PC-1" }, bulkAsset: null, status: "CHECKED_OUT", containerId: "c1" }],
      }),
      makeLineItem({
        id: "b", description: "DMX Cable", categoryName: "Audio",
        units: [{ id: "u-b", asset: { assetTag: "DMX-1" }, bulkAsset: null, status: "CHECKED_OUT", containerId: "c1" }],
      }),
    ];

    const structured = structureLineItems(raw, undefined, { byContainer: true, containers });

    const { groups } = filterAndGroupItems(structured, makeConfig());
    expect(groups.has("Case 12")).toBe(true);
    expect(groups.get("Case 12")!.map((li) => li.id)).toEqual(expect.arrayContaining(["a", "b"]));
  });
});
