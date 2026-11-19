"use client";

/**
 * Shared types + pure predicates for the project Equipment tab. The rows
 * themselves render through `LineRowList` sections (`equipment-sections.tsx`);
 * this module is what the tab, the dialogs, the DnD hook and the reconstruction
 * import for the data shapes, the Drop Matrix and the list-visibility rule.
 */

import type { OverbookedInfo } from "@/lib/overbooking-core";
import type { DiscountMode } from "@/lib/discount-mode";
import type { LineItemData } from "./equipment-row-types";

export type {
  LineItemData,
  GroupData,
  SubHireGroupData,
  MixedGroupSlot,
  CategoryData,
  DropHighlight,
} from "./equipment-row-types";

/**
 * Drop Matrix 8C from the cross-type unification plan. Returns a reason
 * string when the active row is NOT allowed to land on the over target,
 * or null when the drop is allowed (or out of this matrix's scope —
 * positive-path moves are decided downstream by handleDragEnd).
 *
 * The matrix rejects:
 *   - line items (own-stock, custom, kit) dropped onto a sub-hire group
 *   - project groups dropped onto a sub-hire group (no nested groups)
 *   - sub-hire groups dropped onto a project group (no nested groups)
 *
 * It deliberately does NOT reject:
 *   - line items onto categories or project groups (existing flow)
 *   - sub-hire groups dropped onto a category (Drop Matrix row allows the
 *     cross-category move, even though the visual target is a row
 *     belonging to a different kind)
 */
export function getDisallowedDropReason(
  activeId: string,
  overId: string,
): string | null {
  if (activeId.startsWith("li-") && overId.startsWith("shg-")) {
    return "Own-stock, custom, and kit items can't enter a sub-hire group.";
  }
  if (activeId.startsWith("grp-") && overId.startsWith("shg-")) {
    return "Job groups can't be nested inside a sub-hire group.";
  }
  if (activeId.startsWith("shg-") && overId.startsWith("grp-")) {
    return "Sub-hire groups can't be nested inside a job group.";
  }
  return null;
}

// Kit children and sub-hire group children both have isKitChild=true —
// filter them from flat rendering so they only appear nested under their parent.
function isRealKitChild(item: LineItemData) {
  return item.isKitChild === true;
}

// Merge tombstones (status CANCELLED, qty 0) are inert residue left by the
// split-collapse migrations. getProject already filters them at the query
// layer; this is belt-and-suspenders so a stale cache / optimistic update
// can't resurrect a ghost row. Normal line-item removal hard-deletes, so a
// CANCELLED line item is never anything but merge residue.
function isMergeTombstone(item: LineItemData) {
  return item.status === "CANCELLED";
}

// The synthetic parent ProjectLineItem of a sub-hire group has
// `subHireGroupId` set, `isKitChild=false`, and no parent. The tab renders that
// group as a sub-hire section, so this parent line item must NOT also show up
// as a flat row, or every sub-hire group would appear twice.
function isSubHireGroupParent(item: LineItemData) {
  return item.subHireGroupId != null && item.isKitChild !== true;
}

// One predicate for "should this row appear in the flat list".
export function isHiddenFromList(item: LineItemData) {
  return isRealKitChild(item) || isMergeTombstone(item) || isSubHireGroupParent(item);
}

// Row descriptors + the per-unit fulfillment badge map live in a pure module so
// they stay unit-testable without loading this component's Convex/React imports.
// Re-exported here so existing consumers keep importing from equipment-rows.
export {
  describeRow,
  hasContainerChip,
} from "./equipment-row-descriptors";

// Re-exported for back-compat: consumers (equipment-tab.tsx) import this type
// from here. The canonical shape lives in overbooking-core.ts — the single
// source both the server (computeOverbookedStatus) and the native read layer
// (reconstructOverbookedStatus) build, so it stays one definition (R-3.1).
export type { OverbookedInfo };

/** A single inline-edited field on a project group's own price cells. Unlike
 *  `InlineLineItemPatch`'s "discount" variant, `price` and `discount` are
 *  separate variants (not a shared object) because `updateGroupPriceNative`'s
 *  `price` arg is always-required/full-replace while `discount`/
 *  `discountMode` are set-or-clear-when-provided — the caller
 *  (`equipment-tab.tsx`'s `handleInlineGroupPriceUpdate`) needs to know which
 *  one was actually edited to resend the untouched value for the other. */
export type GroupInlinePricePatch =
  | { field: "price"; value: number | undefined }
  | { field: "discount"; value: number | undefined; discountMode: DiscountMode };
