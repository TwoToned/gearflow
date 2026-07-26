// Shared types and utilities for warehouse tab components

export interface LineItem {
  id: string;
  type: string;
  status: string;
  quantity: number;
  checkedOutQuantity: number;
  returnedQuantity: number;
  description: string | null;
  modelId: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  kitId: string | null;
  isKitChild: boolean;
  /** Child discriminator: KIT (kit member) vs ACCESSORY (permanently attached
   *  to a parent asset). Null on top-level lines. */
  childKind?: string | null;
  /** Denormalized tier on an ACCESSORY child line — DEFAULT accessories gate
   *  checkout, OPTIONAL ones only require an explain-why when missing. */
  accessoryInclusion?: "DEFAULT" | "OPTIONAL" | null;
  parentLineItemId: string | null;
  model: { name: string; modelNumber?: string | null; assetType?: string; _count?: { modelCheckItems: number } } | null;
  asset: { assetTag: string } | null;
  bulkAsset: { assetTag: string } | null;
  kit: { id: string; assetTag: string; name: string; checkMode?: string; _count?: { kitCheckItems: number } } | null;
  /**
   * Per-unit fulfillment rows (one per assigned physical asset). The
   * source of truth post-cutover. Renderers should prefer `units` when
   * showing a multi-quantity line's actual assignments — `asset` /
   * `bulkAsset` on the line is null for non-kit non-bulk lines.
   * Filtered to non-CANCELLED at the query layer.
   */
  units?: Array<{
    id: string;
    ordinal: number;
    assetId: string | null;
    bulkAssetId: string | null;
    /** For an ACCESSORY-line unit: the parent unit's asset it travels with. */
    parentUnitAssetId?: string | null;
    quantity: number;
    status: string;
    prepStatus: string | null;
    asset: { id: string; assetTag: string } | null;
    bulkAsset: { id: string; assetTag: string } | null;
  }>;
  prepStatus: string | null;
  prepContainer: string | null;
  isContainerLineItem: boolean;
  isCustomItem: boolean;
  /** Sub-hire association — null = own-stock, non-null = sub-hire from supplier. */
  subHireId: string | null;
  supplier: { name: string } | null;
  childLineItems?: LineItem[];
}

export interface AvailableAsset {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  customName: string | null;
}

export type GroupEntry =
  | { kind: "single"; item: LineItem }
  | { kind: "serialized-group"; groupKey: string; modelName: string; items: LineItem[] }
  | { kind: "bulk-group"; groupKey: string; item: LineItem; unitCount: number }
  | { kind: "kit-group"; groupKey: string; item: LineItem; children: LineItem[] }
  | { kind: "accessory-group"; groupKey: string; item: LineItem; children: LineItem[] };

// "Bulk" means: a multi-unit line item without individual serialized assets.
export function isBulkItem(item: LineItem) {
  if (item.quantity <= 1) return false;
  if (item.bulkAssetId) return true;
  if (!item.assetId) return true;
  return false;
}

// ─── Quantity-aware stage counts for bulk lines ──────────────────────────────
// A bulk line stays a single row through its whole lifecycle (prep no longer
// splits the line). Partial prep/deploy is tracked by per-unit rows in `units`
// (one qty-1 row per prepped item, or a single qty-N row for a tagged bulk
// pool). These helpers derive "how many units belong in each warehouse stage"
// from those rows so a line can appear in Pick AND Prepped at once — the fix
// for "prep 1 of 10 and all 10 jump to Prepped".

function unitQty(u: NonNullable<LineItem["units"]>[number]): number {
  return u.quantity ?? 1;
}

/** Ordered units not yet assigned to any prep/deploy/return row → still to pick. */
export function bulkUnpackedRemaining(item: LineItem): number {
  const assigned = (item.units ?? []).reduce((n, u) => n + unitQty(u), 0);
  return Math.max(0, item.quantity - assigned);
}

/** Packed units not yet deployed or returned → sitting in the Prepped stage. */
export function bulkPackedWaiting(item: LineItem): number {
  return (item.units ?? [])
    .filter(
      (u) =>
        u.status !== "CHECKED_OUT" &&
        u.status !== "RETURNED" &&
        u.prepStatus === "PACKED",
    )
    .reduce((n, u) => n + unitQty(u), 0);
}

export function modelDisplayName(item: LineItem) {
  if (!item.model) return item.description || "Unnamed item";
  return [item.model.name, item.model.modelNumber].filter(Boolean).join(" - ");
}

export function isKitParent(item: LineItem) {
  return !!item.kitId && !item.isKitChild;
}

// An accessory parent is NOT a kit (no kitId) — a top-level line whose
// children include at least one ACCESSORY child (FEATUREDOCS/48). Treated
// like a kit parent for warehouse rendering: accessories always render
// (inseparable, not gated by any "show children" toggle).
export function isAccessoryParent(item: LineItem) {
  if (item.isKitChild || item.kitId) return false;
  return (item.childLineItems ?? []).some((c) => c.childKind === "ACCESSORY");
}

export function accessoryChildrenOf(item: LineItem): LineItem[] {
  return (item.childLineItems ?? []).filter((c) => c.childKind === "ACCESSORY");
}

// Sub-hire group parents have childLineItems but no kitId
export function isGroupParent(item: LineItem) {
  return !item.isKitChild && !item.kitId && (item.childLineItems?.length ?? 0) > 0;
}

export function collectAllVerifiableIds(children: LineItem[], mode: "deploy" | "return"): string[] {
  const ids: string[] = [];
  for (const child of children) {
    const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;

    if (isNestedKit) {
      const grandchildren = child.childLineItems as LineItem[];
      const filtered = mode === "deploy"
        ? grandchildren.filter((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED")
        : grandchildren.filter((gc) => gc.status === "CHECKED_OUT");
      for (const gc of filtered) {
        ids.push(gc.id);
      }
    } else {
      if (mode === "deploy" && child.status !== "CHECKED_OUT" && child.status !== "CANCELLED") {
        ids.push(child.id);
      } else if (mode === "return" && child.status === "CHECKED_OUT") {
        ids.push(child.id);
      }
    }
  }
  return ids;
}

// Selection key helpers
export function bulkUnitKey(lineItemId: string, unitIndex: number) {
  return `${lineItemId}:${unitIndex}`;
}

// ─── Warehouse equipment-stage membership ───────────────────────────────────
// Which of the 5 warehouse stages a top-level equipment line belongs in.
// Extracted as pure, tested functions after a real production bug: treating
// an accessory parent exactly like a kit parent (gated PURELY on child
// status, ignoring the parent's OWN status/prepStatus) made the parent
// silently vanish from a stage whenever its own state and its accessory's
// state happened to diverge. A kit parent is a synthetic rollup with no
// prep/deploy state of its own; an accessory parent is a real, independently
// fulfilled asset that also happens to have accessory children — its stage
// membership must consider BOTH its own state and its children's.

function kitNeedsPrepping(c: LineItem): boolean {
  if (c.status === "CHECKED_OUT" || c.status === "CANCELLED") return false;
  if (c.prepStatus === "PACKED") return false;
  if (c.kitId && c.childLineItems?.length) {
    return c.childLineItems.some((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED" && gc.prepStatus !== "PACKED");
  }
  return true;
}

/** Accessory parent, Pick/Prep test: own asset still needs prep, OR any
 *  accessory child does (extracted so isInPickPrepStage stays under R-3.6). */
function accessoryParentNeedsPrep(item: LineItem): boolean {
  if (item.prepStatus !== "PACKED") return true;
  return accessoryChildrenOf(item).some(
    (c) => c.status !== "CHECKED_OUT" && c.status !== "CANCELLED" && c.prepStatus !== "PACKED",
  );
}

/** Pick/Prep tab: items that still need to be picked and/or prepped. */
export function isInPickPrepStage(item: LineItem): boolean {
  if (item.status === "CANCELLED") return false;
  // Bulk lines are quantity-aware: show while any ordered unit is still
  // unpacked, even once some units are prepped/deployed (kit parents are
  // handled by their child rollup below, never as a bulk line).
  if (isBulkItem(item) && !isKitParent(item)) return bulkUnpackedRemaining(item) > 0;
  if (item.status === "CHECKED_OUT" || item.status === "RETURNED") return false;
  if (isKitParent(item)) return (item.childLineItems ?? []).some(kitNeedsPrepping);
  if (item.quantity <= 0) return false; // exhausted originals post prep-split
  if (isAccessoryParent(item)) return accessoryParentNeedsPrep(item);
  return item.prepStatus !== "PACKED";
}

function kitPreppedNotDeployed(c: LineItem): boolean {
  if (c.status === "CHECKED_OUT" || c.status === "CANCELLED" || c.status === "RETURNED") return false;
  if (c.prepStatus === "PACKED") return true;
  if (c.kitId && c.childLineItems?.length) {
    return c.childLineItems.some((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED" && gc.status !== "RETURNED" && gc.prepStatus === "PACKED");
  }
  return false;
}

/** Accessory parent, Deploy test: own asset is prepped-and-waiting, OR any
 *  accessory child is (extracted so isInPreppedStage stays under R-3.6). */
function accessoryParentPreppedNotDeployed(item: LineItem): boolean {
  if (item.prepStatus === "PACKED") return true;
  return accessoryChildrenOf(item).some(
    (c) => c.status !== "CHECKED_OUT" && c.status !== "CANCELLED" && c.status !== "RETURNED" && c.prepStatus === "PACKED",
  );
}

/** Deploy tab: items prepped (PACKED) but not yet deployed. */
export function isInPreppedStage(item: LineItem): boolean {
  if (item.status === "CANCELLED") return false;
  if (isBulkItem(item) && !isKitParent(item)) return bulkPackedWaiting(item) > 0;
  if (item.status === "CHECKED_OUT" || item.status === "RETURNED") return false;
  if (isKitParent(item)) return (item.childLineItems ?? []).some(kitPreppedNotDeployed);
  if (item.quantity <= 0) return false;
  if (isAccessoryParent(item)) return accessoryParentPreppedNotDeployed(item);
  return item.prepStatus === "PACKED";
}

function kitReturnedPacked(c: LineItem): boolean {
  if (c.status === "RETURNED" && c.prepStatus === "PACKED") return true;
  if (c.kitId && c.childLineItems?.length) {
    return c.childLineItems.some((gc) => gc.status === "RETURNED" && gc.prepStatus === "PACKED");
  }
  return false;
}

/** De-prep staging: gear that's physically back (RETURNED) but still packed. */
export function isInReturnedStage(item: LineItem): boolean {
  if (isKitParent(item)) return (item.childLineItems ?? []).some(kitReturnedPacked);
  const ownReturned = item.status === "RETURNED" && item.prepStatus === "PACKED";
  if (!isAccessoryParent(item)) return ownReturned;
  return ownReturned || accessoryChildrenOf(item).some((c) => c.status === "RETURNED" && c.prepStatus === "PACKED");
}

function kitReturnedNotPacked(c: LineItem): boolean {
  if (c.status === "RETURNED" && c.prepStatus !== "PACKED") return true;
  if (c.kitId && c.childLineItems?.length) {
    return c.childLineItems.some((gc) => gc.status === "RETURNED" && gc.prepStatus !== "PACKED");
  }
  return false;
}

/** De-prepped: returned gear checked back into inventory. Terminal, read-only. */
export function isInDeprepedStage(item: LineItem): boolean {
  if (isKitParent(item)) return (item.childLineItems ?? []).some(kitReturnedNotPacked);
  const ownDeprepped = item.status === "RETURNED" && item.prepStatus !== "PACKED";
  if (!isAccessoryParent(item)) return ownDeprepped;
  return ownDeprepped || accessoryChildrenOf(item).some((c) => c.status === "RETURNED" && c.prepStatus !== "PACKED");
}

function kitChildCheckedOut(c: LineItem): boolean {
  if (c.status === "CHECKED_OUT") return true;
  if (c.kitId && c.childLineItems?.length) {
    return c.childLineItems.some((gc) => gc.status === "CHECKED_OUT");
  }
  return false;
}

/** Return tab: items currently deployed. */
export function isInCheckedOutStage(item: LineItem): boolean {
  if (isKitParent(item)) return (item.childLineItems ?? []).some(kitChildCheckedOut);
  if (isBulkItem(item) && !isAccessoryParent(item)) {
    return item.status === "CHECKED_OUT" && item.checkedOutQuantity > item.returnedQuantity;
  }
  const ownCheckedOut = item.status === "CHECKED_OUT";
  if (!isAccessoryParent(item)) return ownCheckedOut;
  return ownCheckedOut || accessoryChildrenOf(item).some((c) => c.status === "CHECKED_OUT");
}
