/**
 * Pure (React-free) data shapes for the project equipment tree. Split out of
 * `equipment-rows.tsx` so consumers that only need the types (row descriptors,
 * card primitives, forms, dialogs, the reconstruct/hook layer) don't create an
 * import edge into the row-rendering component — that edge is what caused the
 * `equipment-cards.tsx` / `equipment-row-descriptors.ts` / `equipment-rows.tsx`
 * circular-dependency cluster (POLICY.md R-3.5).
 */

export interface LineItemData {
  id: string;
  modelId?: string | null;
  description: string | null;
  quantity: number;
  unitPrice: unknown;
  lineTotal: unknown;
  pricingType?: string;
  duration?: number;
  discount?: unknown;
  /** #1012 — how `discount` was entered ("$" | "%"). Absent = "$". */
  discountMode?: string | null;
  notes?: string | null;
  isOptional?: boolean;
  type?: string;
  priceBreakdown?: string | null;
  priceOverridden?: boolean;
  /** True when `unitPrice`/`discount` were forced to $0/unset by the server's
   *  `defaultToZero` (added or reset while the project was locked, no unlock session
   *  open) — the actual cause `<UnpricedBadge>` reads, instead of inferring it from
   *  "currently locked + currently $0" (which false-positives on a row that's been
   *  $0 since before any lock ever existed). */
  pricedUnderLock?: boolean;
  // `isSubhire` removed (Wave 2). Use `subHireId != null` to detect sub-hire items.
  isCustomItem?: boolean;
  isKitChild?: boolean;
  subHireId?: string | null;
  /** Sub-hire group this synthetic line item belongs to. Used by the
   *  flat-list filter to suppress sub-hire group parent rows now that
   *  SubHireGroupRow renders the group itself (Phase 5c). */
  subHireGroupId?: string | null;
  /** The source `subHireItems` row this generated line was derived from
   *  (only set on sub-hire-sourced lines). Inline edits on a sub-hire GROUP
   *  CHILD row (`subHireGroupId != null`) key off this to route through
   *  `subHiresWrites.updateSubHireItemNative` instead of `patchNative` — a
   *  direct `patchNative` edit would be silently discarded the next time
   *  anything in that sub-hire order changes (`regenerateSubHireLines`
   *  deletes and recreates every derived line). See `line-item-edit-payload.ts`. */
  subHireItemId?: string | null;
  kitId?: string | null;
  /** Child discriminator: KIT (kit member) vs ACCESSORY (permanently attached
   *  to a parent asset). Drives the "Accessory" badge on child rows. */
  childKind?: string | null;
  pricingMode?: string | null;
  status?: string;
  prepStatus?: string | null;
  supplier?: { name: string } | null;
  model?: { name: string; dailyRate?: unknown; weeklyRate?: unknown; monthlyRate?: unknown } | null;
  asset?: { assetTag?: string | null } | null;
  /** Post-cutover per-unit assignments. Source of truth for which
   *  physical assets a multi-quantity line is using. `status` /
   *  `returnCondition` drive the per-unit fulfillment badge (Deployed /
   *  Returned) — RETURNED units are retained as the "what went out" history. */
  units?: Array<{
    id: string;
    ordinal: number;
    status?: string | null;
    returnCondition?: string | null;
    asset?: { id: string; assetTag: string } | null;
    bulkAsset?: { id: string; assetTag: string } | null;
  }>;
  kit?: { name?: string } | null;
  childLineItems?: LineItemData[];
  /** Per-line Xero coding override (WS1 #940 cascade) — first non-null level
   *  wins over model/kit/category/org defaults. See convex/lib/xeroAccountCascade.ts. */
  xeroAccountCode?: string | null;
  xeroTaxType?: string | null;
  /** Optimistic-concurrency baseline — Prisma `updatedAt` (serialised). Sent
   *  back on save so the server can reject stale writes (collaboration). */
  updatedAt?: string | Date | number | null;
}

export interface GroupData {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  price: unknown;
  discount: unknown;
  /** #1012 — how `discount` was entered ("$" | "%"). Absent = "$". */
  discountMode?: string | null;
  suggestedPrice: unknown;
  sortOrder: number;
  /** Mirrors `LineItemData.pricedUnderLock` — see that field's comment. */
  pricedUnderLock?: boolean;
  lineItems?: LineItemData[];
  /** Per-group Xero coding override (WS1 #940 cascade) — a priced group
   *  bills as its own invoice line (financeSnapshot.ts). See
   *  convex/xeroPush.ts resolveGroupLineCode. */
  xeroAccountCode?: string | null;
  xeroTaxType?: string | null;
}

export interface SubHireGroupData {
  id: string;
  title: string;
  quantity: number;
  cost: unknown;
  charge: unknown;
  sortOrder: number;
  targetCategoryId: string | null;
  showOnQuote?: boolean;
  showOnDocs?: boolean;
  subHire: {
    id: string;
    orderNumber: string;
    status: string;
    supplier?: { id: string; name: string } | null;
  };
  /** Full per-item detail (not just the display-relevant subset) — the extra
   *  fields (modelId, groupId, pricingType, duration, discount, showOnQuote,
   *  showOnDocs, targetCategoryId, targetGroupId, notes) are what
   *  `computeInlineSubHireItemInput` needs to round-trip
   *  `updateSubHireItemNative`'s full-replace payload from a single changed
   *  inline-edited field. All of these are already present at runtime
   *  (`mapSubHireItem` in `equipment-tab-reconstruct.ts` returns the full
   *  row) — this just widens the type to admit them. */
  items?: Array<{
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
  }>;
  /** Synthetic parent ProjectLineItem(s) — usually 0 or 1. The parent's
   *  childLineItems are what the row renders when expanded. */
  lineItems?: LineItemData[];
}

/** Discriminated slot used by equipment-tab to iterate the mixed
 *  ProjectGroup + SubHireGroup list inside a category in CategorySlot
 *  order (Phase 5b). */
export type MixedGroupSlot =
  | { kind: "project"; sortOrder: number; projectGroupId: string }
  | { kind: "subHire"; sortOrder: number; subHireGroupId: string };

export interface CategoryData {
  id: string;
  name: string;
  sortOrder: number;
  groups: GroupData[];
  subHireGroupTargets?: SubHireGroupData[];
  mixedGroups?: MixedGroupSlot[];
  lineItems?: LineItemData[];
}
