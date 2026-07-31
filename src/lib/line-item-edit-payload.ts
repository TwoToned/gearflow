/**
 * Single source of truth for turning a line item's current values (+ any
 * override) into the payload `lineItemWrites.update` sends to `patchNative`.
 * Shared by the full edit dialog (`edit-line-item-dialog.tsx`) and the
 * inline-edit cells (`line-item-inline-cells.tsx`) so both paths default
 * every field and resolve the $/% discount conversion identically — a second
 * hand-maintained copy of this would be a defect even while in sync
 * (POLICY.md R-3.1/R-8.6.1).
 */

import type { LineItemFormValues } from "@/lib/validations/line-item";
import {
  type DiscountMode,
  discountEntryValue,
  resolveDiscountAmount,
  toDiscountMode,
} from "@/lib/discount-mode";
import type { LineItemData } from "@/components/projects/equipment-row-types";

export interface EditLineItemPayload {
  type: string;
  quantity: number;
  unitPrice?: number;
  description: string;
  pricingType: string;
  duration: number;
  discount?: number;
  /** #1012 — how the discount above was entered; persisted for document display. */
  discountMode?: DiscountMode;
  notes?: string;
  isOptional: boolean;
  xeroAccountCode?: string;
  xeroTaxType?: string;
}

/**
 * #1012 — re-derive the discount the way it was ENTERED: a line saved as 15%
 * resolves back to "15" with mode `%`, not the flat dollar amount with mode
 * reset to `$` (which would silently rewrite the stored entry shape on the
 * next save). The percentage is derived from the stored dollar amount against
 * the line's current gross — see `src/lib/discount-mode.ts`.
 */
export function initialDiscountEntry(item: LineItemData): { value: string; mode: DiscountMode } {
  const mode = toDiscountMode(item.discountMode);
  const gross = Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1) * Number(item.duration ?? 1);
  return { value: discountEntryValue(item.discount != null ? Number(item.discount) : null, mode, gross), mode };
}

/** The full `LineItemFormValues` baseline for editing `item` — every field
 *  seeded from its current value, matching what the edit dialog's form opens
 *  with. Callers spread this and override only the field(s) actually being
 *  changed (e.g. a single inline-edited cell). */
export function buildLineItemFormDefaults(item: LineItemData): LineItemFormValues {
  const initialDiscount = initialDiscountEntry(item);
  return {
    type: (item.type as LineItemFormValues["type"]) ?? "EQUIPMENT",
    description: item.description ?? item.model?.name ?? "",
    quantity: item.quantity,
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : undefined,
    pricingType: (item.pricingType as LineItemFormValues["pricingType"]) ?? "PER_DAY",
    duration: item.duration ?? 1,
    discount: initialDiscount.value !== "" ? Number(initialDiscount.value) : undefined,
    notes: item.notes ?? "",
    isOptional: item.isOptional ?? false,
    xeroAccountCode: item.xeroAccountCode ?? "",
    xeroTaxType: item.xeroTaxType ?? "",
  };
}

/** Resolves a (possibly partially-overridden) form-values object into the
 *  payload the caller hands to `updateLineItemMut` (dialog submit or a single
 *  inline-edited field layered onto `buildLineItemFormDefaults`). */
export function computeEditLineItemPayload(
  item: LineItemData,
  data: LineItemFormValues,
  discountMode: DiscountMode,
): EditLineItemPayload {
  const qty = Number(data.quantity) || 1;
  const price = data.unitPrice != null ? Number(data.unitPrice) : undefined;
  const dur = Number(data.duration) || item.duration || 1;
  // #1012: shared conversion (resolveDiscountAmount) + the mode is submitted
  // alongside the resolved amount instead of being discarded.
  const disc = resolveDiscountAmount(discountMode, data.discount as number | string | undefined, (price ?? 0) * qty * dur);
  return {
    type: data.type ?? item.type ?? "EQUIPMENT",
    quantity: qty,
    unitPrice: price,
    description: data.description ?? "",
    pricingType: data.pricingType ?? item.pricingType ?? "PER_DAY",
    duration: dur,
    discount: disc,
    discountMode,
    notes: data.notes || undefined,
    isOptional: data.isOptional ?? false,
    xeroAccountCode: data.xeroAccountCode || undefined,
    xeroTaxType: data.xeroTaxType || undefined,
  };
}

/** A single inline-edited field, as produced by the table cell components in
 *  `line-item-inline-cells.tsx`. Only ever one field per patch — each cell
 *  saves independently on blur/Tab, there's no multi-field inline form.
 *
 *  `discountPercent` is the odd one out: it's never routed through THIS
 *  module. A sub-hire GROUP CHILD row (`item.subHireGroupId != null`) renders
 *  a plain 0-100% discount cell (`InlineEditablePercent`, no `$`/`%` toggle —
 *  sub-hire items don't have that concept) and its patches route through
 *  `sub-hire-item-edit-payload.ts`'s `computeInlineSubHireItemInput` instead
 *  — see `equipment-tab.tsx`'s `handleInlineLineItemUpdate`. It's declared
 *  here anyway so `LineItemRow` has ONE patch union for its `onInlineUpdate`
 *  prop regardless of which backend a given row ends up routed to. */
export type InlineLineItemPatch =
  | { field: "description"; value: string }
  | { field: "notes"; value: string }
  | { field: "unitPrice"; value: number | undefined }
  | { field: "discount"; value: number | undefined; discountMode: DiscountMode }
  | { field: "discountPercent"; value: number }
  /** `allowOverbook` — set true only on a confirmed retry after the first
   *  attempt (allowOverbook: false) came back INSUFFICIENT_STOCK. See
   *  `InlineEditableQuantity` and `equipment-tab.tsx`'s
   *  `handleInlineLineItemUpdate`, which reads it straight through to the
   *  mutate call (never routed through this module's own payload — quantity
   *  IS one of this module's fields, `allowOverbook` is a sibling mutate arg,
   *  not a payload field). Ignored on the sub-hire-item route — those items
   *  have no availability concept to overbook. */
  | { field: "quantity"; value: number; allowOverbook: boolean };

/** Layers a single inline-edited field onto `item`'s current values and
 *  resolves the full update payload — the inline-edit equivalent of the
 *  dialog's `handleSave` calling `computeEditLineItemPayload` with the whole
 *  form. Every other field passes through unchanged via
 *  `buildLineItemFormDefaults`. Never called with a `discountPercent` patch —
 *  see the type doc above. */
export function computeInlineLineItemPayload(
  item: LineItemData,
  patch: Exclude<InlineLineItemPatch, { field: "discountPercent" }>,
): EditLineItemPayload {
  const defaults = buildLineItemFormDefaults(item);
  const discountMode = patch.field === "discount" ? patch.discountMode : toDiscountMode(item.discountMode);
  const data: LineItemFormValues = {
    ...defaults,
    ...(patch.field === "description" ? { description: patch.value } : {}),
    ...(patch.field === "notes" ? { notes: patch.value } : {}),
    ...(patch.field === "unitPrice" ? { unitPrice: patch.value } : {}),
    ...(patch.field === "discount" ? { discount: patch.value } : {}),
    ...(patch.field === "quantity" ? { quantity: patch.value } : {}),
  };
  return computeEditLineItemPayload(item, data, discountMode);
}
