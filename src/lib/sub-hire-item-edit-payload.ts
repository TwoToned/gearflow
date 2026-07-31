/**
 * Single source of truth for turning a sub-hire GROUP CHILD item's current
 * values (+ one inline-edited field) into the full-replace payload
 * `useSubHireWrites().updateItem` sends to `subHiresWrites.updateSubHireItemNative`.
 *
 * This is a DIFFERENT write than `line-item-edit-payload.ts`'s
 * `computeInlineLineItemPayload` — a sub-hire group child's generated
 * `ProjectLineItem` row is a derived/display copy (`isKitChild: true`,
 * `subHireItemId` pointing at the real `subHireItems` row). Patching the
 * derived row directly via `patchNative` would appear to work but silently
 * vanish the next time anything in that sub-hire order changes —
 * `regenerateSubHireLines` deletes and recreates every derived line from the
 * `subHireItems`/`subHireGroups` source of truth. So an inline edit on one of
 * these rows must patch the SOURCE `subHireItems` row instead.
 *
 * Also unlike regular line items: a sub-hire item's discount is always a
 * plain 0-100 percentage (no `$`/`%` entry-mode toggle — see
 * `src/lib/validations/sub-hire.ts`'s `subHireItemSchema`), and there is no
 * separate "resolved amount" — the percentage IS what's stored.
 */

import type { SubHireItemInput } from "@/hooks/use-sub-hire-writes";
import type { InlineLineItemPatch } from "@/lib/line-item-edit-payload";

/** The subset of a sub-hire group child's full item detail this module
 *  needs — matches the widened `SubHireGroupData.items[number]` shape
 *  (`equipment-row-types.ts`), which already carries every field at runtime
 *  (`mapSubHireItem` in `equipment-tab-reconstruct.ts`). */
export interface SubHireItemRowLike {
  id: string;
  modelId?: string | null;
  groupId?: string | null;
  description?: string | null;
  quantity: number;
  unitCost?: unknown;
  unitCharge?: unknown;
  pricingType?: string;
  duration?: number;
  discount?: unknown;
  showOnQuote?: boolean;
  showOnDocs?: boolean;
  targetCategoryId?: string | null;
  targetGroupId?: string | null;
  notes?: string | null;
}

const PRICING_TYPES = ["FLAT", "PER_DAY", "PER_WEEK", "PER_HOUR"] as const;

function toPricingType(value: string | undefined): SubHireItemInput["pricingType"] {
  return (PRICING_TYPES as readonly string[]).includes(value ?? "") ? (value as SubHireItemInput["pricingType"]) : "FLAT";
}

/** `null` -> `undefined` — the shape every optional `SubHireItemInput` field
 *  needs (the mutation args are `v.optional(...)`, not nullable). Pulled out
 *  so `buildSubHireItemInput`'s own branch count stays under R-3.6's
 *  complexity ratchet instead of inlining five `?? undefined`s. */
function orUndef<T>(v: T | null | undefined): T | undefined {
  return v ?? undefined;
}

/** The full `SubHireItemInput` baseline for editing `item` — every field
 *  seeded from its current value, so a single inline-edited field can be
 *  layered on top without clobbering the rest (the mutation is a full
 *  replace, not a partial patch). */
export function buildSubHireItemInput(item: SubHireItemRowLike): SubHireItemInput {
  return {
    modelId: orUndef(item.modelId),
    groupId: orUndef(item.groupId),
    description: item.description ?? "",
    quantity: item.quantity,
    unitCost: Number(item.unitCost ?? 0),
    unitCharge: Number(item.unitCharge ?? 0),
    pricingType: toPricingType(item.pricingType),
    duration: item.duration ?? 1,
    discount: Number(item.discount ?? 0),
    showOnQuote: item.showOnQuote,
    showOnDocs: item.showOnDocs,
    targetCategoryId: orUndef(item.targetCategoryId),
    targetGroupId: orUndef(item.targetGroupId),
    notes: orUndef(item.notes),
  };
}

/** The subset of `InlineLineItemPatch` a sub-hire group child row can send —
 *  `unitPrice` maps to the sub-hire item's `unitCharge` (the client-facing
 *  price; `unitCost` is a supplier figure this inline surface never
 *  touches), and `discountPercent` (plain 0-100, no `$`/`%` toggle — rendered
 *  by `InlineEditablePercent`, not `InlineEditableDiscount`) replaces the
 *  regular `discount` variant, which these rows never send. */
export type InlineSubHireItemPatch = Exclude<InlineLineItemPatch, { field: "discount" }>;

/** Layers a single inline-edited field onto `item`'s current values and
 *  resolves the full `updateSubHireItemNative` payload. */
export function computeInlineSubHireItemInput(
  item: SubHireItemRowLike,
  patch: InlineSubHireItemPatch,
): SubHireItemInput {
  const base = buildSubHireItemInput(item);
  switch (patch.field) {
    case "description":
      return { ...base, description: patch.value };
    case "notes":
      return { ...base, notes: patch.value || undefined };
    case "unitPrice":
      return { ...base, unitCharge: patch.value ?? 0 };
    case "discountPercent":
      return { ...base, discount: patch.value };
  }
}
