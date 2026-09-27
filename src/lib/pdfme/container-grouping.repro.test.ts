/**
 * Phase 0 repro (gearflow#1297, tracking #1296) — pins defect #2 from
 * docs/designs/packing-containers-manifest.md §1.5 ("containers never
 * print"). `structureLineItems` stamps `groupName` (the category, or
 * `[Kit] <name>`, or "Uncategorized") on every row it emits, and the
 * downstream table (`filterAndGroupItems`, line-items-table.tsx) buckets by
 * `item.groupName || item.prepContainer`. Since `groupName` is always
 * truthy, the category always wins and `prepContainer` is dead — two items
 * packed into the same case, in different categories, never surface as one
 * container section on any PDF.
 *
 * `it.fails`: expected to fail today; phase 3's `byContainer` structuring
 * mode replaces this file with the real regression test (build plan phase
 * 3a: "Phase 0's PDF repro goes green here").
 */
import { describe, it, expect } from "vitest";
import { structureLineItems, type CategoryForStructuring } from "./structure-line-items";
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

function makeCategory(id: string, name: string, sortOrder: number): CategoryForStructuring {
  return { id, name, sortOrder, groups: [] };
}

describe("container grouping (defect #2, §1.5)", () => {
  it.fails("two items packed into the same case, from different categories, surface under one container section", () => {
    const categories = [makeCategory("cat-lighting", "Lighting", 0), makeCategory("cat-audio", "Audio", 1)];
    const raw = [
      makeLineItem({ id: "a", description: "Par Can", categoryName: "Lighting", prepContainer: "Case 12" }),
      makeLineItem({ id: "b", description: "DMX Cable", categoryName: "Audio", prepContainer: "Case 12" }),
    ];

    const structured = structureLineItems(raw, categories, { expandProjectGroups: true });

    // Today's actual (buggy) behaviour: the category always wins.
    expect(structured.find(li => li.id === "a")?.groupName).toBe("Lighting");
    expect(structured.find(li => li.id === "b")?.groupName).toBe("Audio");

    // Desired: both items should end up sectioned together under their
    // container, not scattered across two unrelated category sections —
    // false today, since `groupName` (always set) shadows `prepContainer`
    // in filterAndGroupItems's bucket key.
    const { groups } = filterAndGroupItems(structured, makeConfig());
    expect(groups.has("Case 12")).toBe(true);
  });
});
