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
    /** #1296 — the REAL container this unit is packed into (a `projectContainers`
     *  row id), the source of truth over the line's own `prepContainer` string
     *  below. See `resolveItemContainerId`. */
    containerId?: string | null;
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
  | {
      kind: "bulk-group";
      groupKey: string;
      item: LineItem;
      unitCount: number;
      /** Set only for a quantity>1 ACCESSORY parent: the per-unit selection
       *  keys stay (so a subset of units can be picked/prepped/deployed/
       *  returned) AND its accessories still render under the row. */
      accessoryChildren?: LineItem[];
    }
  | { kind: "kit-group"; groupKey: string; item: LineItem; children: LineItem[] }
  | { kind: "accessory-group"; groupKey: string; item: LineItem; children: LineItem[] };

/** The selection keys ONE `GroupEntry` exposes: a bare line-item id for
 *  single/kit/accessory entries (each serialized item for a serialized group),
 *  a positional `bulkUnitKey` per unit for a bulk entry (including a bulk
 *  ACCESSORY parent, which keeps per-unit selection). Single source of truth
 *  for page.tsx's `all*Keys` and "Deploy container" (#1296 D4). */
function selectionKeysForEntry(entry: GroupEntry): string[] {
  if (entry.kind === "single") return [entry.item.id];
  if (entry.kind === "serialized-group") return entry.items.map((i) => i.id);
  if (entry.kind === "kit-group" || entry.kind === "accessory-group") return [entry.item.id];
  return Array.from({ length: entry.unitCount }, (_, u) => bulkUnitKey(entry.item.id, u));
}

export function selectionKeysForEntries(entries: GroupEntry[]): string[] {
  return entries.flatMap(selectionKeysForEntry);
}

/** Every selection key a list of `GroupEntry` would expose. Used by "Deploy
 *  container" (#1296 D4) to select an entire container's contents in one
 *  click — reuses the EXISTING selection state and Deploy button. */
export function keysForGroupEntries(entries: GroupEntry[]): string[] {
  return selectionKeysForEntries(entries);
}

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
 *  accessory child does (extracted so isInPickPrepStage stays under R-3.6).
 *  Deliberately does NOT early-return on the parent's own CHECKED_OUT/
 *  RETURNED status — a "Deploy Verified Only" partial deploy can leave the
 *  parent already deployed while an unverified accessory sibling is still
 *  sitting unprepped, and that sibling must stay actionable here (issue #794's
 *  partial-deploy criterion) instead of vanishing once its parent moves on. */
function accessoryParentNeedsPrep(item: LineItem): boolean {
  if (item.quantity <= 0) return false; // exhausted originals post prep-split
  const ownNeedsPrep = item.status !== "CHECKED_OUT" && item.status !== "RETURNED" && item.prepStatus !== "PACKED";
  if (ownNeedsPrep) return true;
  return accessoryChildrenNeedPrep(item);
}

function accessoryChildrenNeedPrep(item: LineItem): boolean {
  return accessoryChildrenOf(item).some(
    (c) => c.status !== "CHECKED_OUT" && c.status !== "CANCELLED" && c.prepStatus !== "PACKED",
  );
}

/** A bulk line stays in Pick/Prep while any unit is unpacked OR any of its accessories still needs prep. */
function bulkLineNeedsPrep(item: LineItem): boolean {
  return bulkUnpackedRemaining(item) > 0 || (isAccessoryParent(item) && accessoryChildrenNeedPrep(item));
}

/** Deploy-side twin of bulkLineNeedsPrep. */
function bulkLinePreppedNotDeployed(item: LineItem): boolean {
  return bulkPackedWaiting(item) > 0 || (isAccessoryParent(item) && accessoryParentPreppedNotDeployed(item));
}

/** Pick/Prep tab: items that still need to be picked and/or prepped. */
export function isInPickPrepStage(item: LineItem): boolean {
  if (item.status === "CANCELLED") return false;
  // Bulk lines are quantity-aware: show while any ordered unit is still
  // unpacked, even once some units are prepped/deployed (kit parents are
  // handled by their child rollup below, never as a bulk line).
  // An accessory parent also stays while any of its accessories still needs
  // prep, even if every parent unit is already packed.
  if (isBulkItem(item) && !isKitParent(item)) return bulkLineNeedsPrep(item);
  // Accessory parents are checked BEFORE the blanket CHECKED_OUT/RETURNED
  // early-return (see accessoryParentNeedsPrep) — everyone else still exits
  // early on it.
  if (isAccessoryParent(item)) return accessoryParentNeedsPrep(item);
  if (item.status === "CHECKED_OUT" || item.status === "RETURNED") return false;
  if (isKitParent(item)) return (item.childLineItems ?? []).some(kitNeedsPrepping);
  if (item.quantity <= 0) return false; // exhausted originals post prep-split
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
 *  accessory child is (extracted so isInPreppedStage stays under R-3.6).
 *  Same "don't hide behind the parent's own terminal status" reasoning as
 *  accessoryParentNeedsPrep above — a left-behind packed accessory must stay
 *  visible here even once its parent is already CHECKED_OUT. */
function accessoryParentPreppedNotDeployed(item: LineItem): boolean {
  if (item.quantity <= 0) return false;
  const ownWaiting = item.status !== "CHECKED_OUT" && item.status !== "RETURNED" && item.prepStatus === "PACKED";
  if (ownWaiting) return true;
  return accessoryChildrenOf(item).some(
    (c) => c.status !== "CHECKED_OUT" && c.status !== "CANCELLED" && c.status !== "RETURNED" && c.prepStatus === "PACKED",
  );
}

/** Deploy tab: items prepped (PACKED) but not yet deployed. */
export function isInPreppedStage(item: LineItem): boolean {
  if (item.status === "CANCELLED") return false;
  if (isBulkItem(item) && !isKitParent(item)) return bulkLinePreppedNotDeployed(item);
  if (isAccessoryParent(item)) return accessoryParentPreppedNotDeployed(item);
  if (item.status === "CHECKED_OUT" || item.status === "RETURNED") return false;
  if (isKitParent(item)) return (item.childLineItems ?? []).some(kitPreppedNotDeployed);
  if (item.quantity <= 0) return false;
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

// ─── Container-based sectioning (#1296 phase 2) ─────────────────────────────
// The Deploy/Return/De-prep tabs section their lists by "which container this
// gear is packed into". `item.prepContainer` (a free-text string, dual-written
// at prep time) is the legacy grouping key; the REAL identity is the majority
// `containerId` among the item's own units (mirrors
// `structure-line-items-by-container.ts`'s `majorityContainerId` — same
// question, independently reimplemented here since that module lives in
// `src/lib/pdfme` and is PDF-shape-specific, not a dependency this page
// should take on for a client-only grouping concern). Grouping by containerId
// rather than the label means two units in the SAME real container never
// split into two sections just because their `prepContainer` strings drifted
// (or one was never backfilled) — the exact class of bug D9's migration
// (widen → migrate → narrow) exists to close.

function unitMajorityContainerId(units: LineItem["units"]): string | null {
  if (!units || units.length === 0) return null;
  const counts = new Map<string | null, number>();
  for (const u of units) {
    const key = u.containerId ?? null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [key, n] of counts) {
    if (n > bestN) {
      best = key;
      bestN = n;
    }
  }
  return best;
}

/** The real container id an item's units are (majority) packed into, or
 *  `null` when none of its units carry one (pre-migration data, or gear
 *  that's never been prepped through the rail). */
export function resolveItemContainerId(item: LineItem): string | null {
  return unitMajorityContainerId(item.units);
}

export interface ContainerGroup<T> {
  /** Display label for the section header — `null` renders as "no container"
   *  UI (see deploy-tab.tsx's `.some((g) => g.container !== null)` checks). */
  container: string | null;
  entries: T[];
}

/**
 * Bucket a list of (already-grouped) entries by their representative item's
 * container, preferring the REAL `containerId` (resolved to its current
 * label via `containerLabelById`) and falling back to the legacy
 * `prepContainer` string when no real container is resolved. Named
 * containers sort alphabetically by label; the ungrouped bucket sorts last.
 */
export function buildContainerGroups<T>(
  entries: T[],
  representativeItem: (entry: T) => LineItem,
  containerLabelById: Map<string, string>,
): ContainerGroup<T>[] {
  const byBucketKey = new Map<string, T[]>();
  const labelByBucketKey = new Map<string, string | null>();

  for (const entry of entries) {
    const item = representativeItem(entry);
    const containerId = resolveItemContainerId(item);
    const bucketKey = containerId ? `id:${containerId}` : item.prepContainer ? `label:${item.prepContainer}` : "";
    const label = containerId ? (containerLabelById.get(containerId) ?? item.prepContainer ?? null) : item.prepContainer || null;
    if (!byBucketKey.has(bucketKey)) {
      byBucketKey.set(bucketKey, []);
      labelByBucketKey.set(bucketKey, label);
    }
    byBucketKey.get(bucketKey)!.push(entry);
  }

  const sortedKeys = [...byBucketKey.keys()].sort((a, b) => {
    const la = labelByBucketKey.get(a) ?? null;
    const lb = labelByBucketKey.get(b) ?? null;
    if (la === null && lb === null) return 0;
    if (la === null) return 1;
    if (lb === null) return -1;
    return la.localeCompare(lb);
  });

  return sortedKeys.map((bucketKey) => ({
    container: labelByBucketKey.get(bucketKey) ?? null,
    entries: byBucketKey.get(bucketKey)!,
  }));
}

// ─── Move to… (#1296 phase 2) ───────────────────────────────────────────────
// Reassign a Deploy/Return/De-prep selection to a different container (or to
// Loose) — the UI half of `projectContainersWrites.moveUnitsNative`, which
// already exists and takes real unit ids.

type Unit = NonNullable<LineItem["units"]>[number];

function collectRelevantUnitIds(item: LineItem, isRelevant: (u: Unit) => boolean): string[] {
  const own = (item.units ?? []).filter(isRelevant).map((u) => u.id);
  const fromChildren = (item.childLineItems ?? []).flatMap((c) => collectRelevantUnitIds(c, isRelevant));
  return [...own, ...fromChildren];
}

/** Deploy tab: units packed (PACKED) but not yet deployed or returned. */
export function isMoveableAtDeployStage(u: Unit): boolean {
  return u.status !== "CHECKED_OUT" && u.status !== "RETURNED" && u.prepStatus === "PACKED";
}

/** Return tab: units currently deployed (about to be checked in). */
export function isMoveableAtReturnStage(u: Unit): boolean {
  return u.status === "CHECKED_OUT";
}

/** De-prep tab: units physically back but still packed. */
export function isMoveableAtDeprepStage(u: Unit): boolean {
  return u.status === "RETURNED" && u.prepStatus === "PACKED";
}

/**
 * Resolve a Deploy/Return/De-prep tab's selection — the SAME key format
 * `handleCheckOutSelected`/`handlePrepSelected` already parse: a bare
 * line-item id for a single/serialized/kit-parent/accessory-parent
 * selection, or a positional `bulkUnitKey(lineItemId, index)` for a bulk
 * line's per-unit checkbox — down to the real unit ids to move together
 * (#1296 Move-to…).
 *
 * A kit/accessory parent's own key means "move the whole group": every
 * descendant's relevant units too, via `childLineItems` recursion (D3's
 * "the whole kit moves together" convention, same one
 * `structure-line-items-by-container.ts` uses for documents). A bulk key
 * only ever carries a COUNT — `handleCheckOutSelected`'s own `bulkQtyMap`
 * parsing already treats the index as a tally, never a specific unit's
 * identity, because nothing else does either — so N selected indices
 * resolve to the first N stage-relevant units in array order (the same
 * order the bulk-group row itself renders `units[idx]` in).
 */
export function resolveSelectionToUnitIds(
  selectedKeys: Set<string>,
  lineItems: LineItem[],
  isRelevant: (u: Unit) => boolean,
): string[] {
  const bulkCounts = new Map<string, number>();
  const wholeIds: string[] = [];

  for (const key of selectedKeys) {
    if (key.includes(":")) {
      const lineItemId = key.split(":")[0];
      bulkCounts.set(lineItemId, (bulkCounts.get(lineItemId) ?? 0) + 1);
    } else {
      wholeIds.push(key);
    }
  }

  const unitIds: string[] = [];
  for (const id of wholeIds) {
    const li = lineItems.find((l) => l.id === id);
    if (li) unitIds.push(...collectRelevantUnitIds(li, isRelevant));
  }
  for (const [lineItemId, count] of bulkCounts) {
    const li = lineItems.find((l) => l.id === lineItemId);
    if (!li) continue;
    const relevant = (li.units ?? []).filter(isRelevant);
    unitIds.push(...relevant.slice(0, count).map((u) => u.id));
  }
  return unitIds;
}

// ─── Grouping (pure; page.tsx renders the result) ───────────────────────────

/** Per-unit count of a bulk line that is actionable in a stage: units still to
 *  pick (`prep`), packed-and-waiting (`prepped`), else the whole quantity. */
function bulkStageUnitCount(item: LineItem, countStage?: "prep" | "prepped"): number {
  if (countStage === "prep") return bulkUnpackedRemaining(item);
  if (countStage === "prepped") return bulkPackedWaiting(item);
  return item.quantity;
}

/** Accessory children listed under a parent in Pick/Deploy/De-prep. Never
 *  cancelled or already-deployed ones; in Pick (`prep`) also never ones already
 *  packed — they have nothing left to verify there (a packed accessory showing
 *  "0/N verified" in Pick was the symptom). */
export function accessoryChildrenForStage(item: LineItem, countStage?: "prep" | "prepped"): LineItem[] {
  return accessoryChildrenOf(item).filter(
    (c) =>
      c.status !== "CANCELLED" &&
      c.status !== "CHECKED_OUT" &&
      !(countStage === "prep" && c.prepStatus === "PACKED"),
  );
}

/** The ids the checkout mutation's `includeAccessoryIds` narrows by: an
 *  accessory's asset / bulk-asset id, read from the child LINE and from its
 *  per-unit rows (an accessory whose assets live only on `units` has none on
 *  the line itself). Deduped; single source of truth for every call site. */
export function accessoryAssetIds(children: LineItem[]): string[] {
  const ids = new Set<string>();
  for (const c of children) {
    if (c.assetId) ids.add(c.assetId);
    if (c.bulkAssetId) ids.add(c.bulkAssetId);
    for (const u of c.units ?? []) {
      if (u.assetId) ids.add(u.assetId);
      if (u.bulkAssetId) ids.add(u.bulkAssetId);
    }
  }
  return [...ids];
}

/** Accessory parent's "Partial" badge: some accessories already deployed
 *  while others are still waiting (grouped entries strip deployed children, so
 *  this reads the item's own, unfiltered accessories). */
export function isAccessoryParentPartiallyDeployed(item: LineItem): boolean {
  const acc = accessoryChildrenOf(item).filter((c) => c.status !== "CANCELLED");
  return acc.some((c) => c.status === "CHECKED_OUT") && acc.some((c) => c.status !== "CHECKED_OUT");
}

// `countStage` picks how a bulk line's per-unit count is derived so a partially
// prepped line shows the right number of units in each tab: the units still to
// pick in Pick, and the units packed-and-waiting in Prepped. Omitted (De-prep /
// legacy) keeps the whole ordered quantity.
export function groupItems(
  items: LineItem[],
  mode: "prep" | "deploy" = "prep",
  countStage?: "prep" | "prepped",
): GroupEntry[] {
  const serializedByModel = new Map<string, LineItem[]>();
  const result: GroupEntry[] = [];

  for (const item of items) {
    if (isKitParent(item)) {
      // Deploy tab: show children that aren't checked out, or nested kits with undeployed grandchildren
      const allChildren = (item.childLineItems || []) as LineItem[];
      const deployChildren = allChildren.filter((c) => {
        if (c.status === "CANCELLED") return false;
        if (c.status !== "CHECKED_OUT") return true;
        // Nested kit that's checked out: still include if any grandchildren need deploying
        if (c.kitId && c.childLineItems?.length) {
          return (c.childLineItems as LineItem[]).some(
            (gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED"
          );
        }
        return false;
      });
      result.push({
        kind: "kit-group",
        groupKey: `kit-${item.id}`,
        item,
        children: deployChildren,
      });
    } else if (isAccessoryParent(item)) {
      // Deploy tab: accessories render like a kit's children — always visible,
      // not gated behind the prep asset-picker (issue #794 follow-up).
      const accessoryChildren = accessoryChildrenForStage(item, countStage);
      const unitCount = bulkStageUnitCount(item, countStage);
      if (isBulkItem(item) && unitCount > 0) {
        // quantity>1 parent: keep per-unit selection AND the accessories.
        result.push({ kind: "bulk-group", groupKey: `bulk-${item.id}`, item, unitCount, accessoryChildren });
      } else {
        result.push({ kind: "accessory-group", groupKey: `acc-${item.id}`, item, children: accessoryChildren });
      }
    } else if (isBulkItem(item)) {
      // Bulk items (qty > 1) show as expandable groups with per-unit rows
      // just like serialized groups. unitCount reflects the units actionable in
      // this stage (still-to-pick vs packed-and-waiting) so a partially prepped
      // line shows the right count in each tab.
      const unitCount = bulkStageUnitCount(item, countStage);
      result.push({
        kind: "bulk-group",
        groupKey: `bulk-${item.id}`,
        item,
        unitCount,
      });
    } else if (item.model) {
      const modelKey = item.model.name + (item.model.modelNumber ? ` - ${item.model.modelNumber}` : "");
      // In deploy mode, items in different containers must be in separate groups
      // so each group's container is unambiguous for the container section headers
      const containerSuffix = mode === "deploy" ? `\0${item.prepContainer || ""}` : "";
      const key = modelKey + containerSuffix;
      const existing = serializedByModel.get(key);
      if (existing) {
        existing.push(item);
      } else {
        const arr = [item];
        serializedByModel.set(key, arr);
        result.push({ kind: "serialized-group", groupKey: `ser-${key}`, modelName: modelKey, items: arr });
      }
    } else {
      result.push({ kind: "single", item });
    }
  }

  // Flatten serialized groups with only 1 item
  return result.map((e) => {
    if (e.kind === "serialized-group" && e.items.length === 1) {
      return { kind: "single" as const, item: e.items[0] };
    }
    if (e.kind === "bulk-group" && e.unitCount <= 1 && e.unitCount === e.item.quantity) {
      return { kind: "single" as const, item: e.item };
    }
    return e;
  });
}

/** Return-tab entry for an accessory parent: per-unit (bulk) when it has units out, else one row. */
function returnAccessoryEntry(item: LineItem): GroupEntry {
  const returnChildren = accessoryChildrenOf(item).filter((c) => c.status === "CHECKED_OUT");
  const unitCount = Math.max(item.checkedOutQuantity - item.returnedQuantity, 0);
  if (isBulkItem(item) && unitCount > 0) {
    return { kind: "bulk-group", groupKey: `bulk-in-${item.id}`, item, unitCount, accessoryChildren: returnChildren };
  }
  return { kind: "accessory-group", groupKey: `acc-in-${item.id}`, item, children: returnChildren };
}

export function groupCheckinItems(items: LineItem[]): GroupEntry[] {
  const serializedByModel = new Map<string, LineItem[]>();
  const result: GroupEntry[] = [];

  for (const item of items) {
    if (isKitParent(item)) {
      // Return tab: show children that are checked out, or nested kits with deployed grandchildren
      const allChildren = (item.childLineItems || []) as LineItem[];
      const returnChildren = allChildren.filter((c) => {
        if (c.status === "CHECKED_OUT") return true;
        // Nested kit not checked out: still include if any grandchildren are deployed
        if (c.kitId && c.childLineItems?.length) {
          return (c.childLineItems as LineItem[]).some((gc) => gc.status === "CHECKED_OUT");
        }
        return false;
      });
      result.push({
        kind: "kit-group",
        groupKey: `kit-in-${item.id}`,
        item,
        children: returnChildren,
      });
    } else if (isAccessoryParent(item)) {
      result.push(returnAccessoryEntry(item));
    } else if (isBulkItem(item)) {
      const remaining = item.checkedOutQuantity - item.returnedQuantity;
      result.push({
        kind: "bulk-group",
        groupKey: `bulk-in-${item.id}`,
        item,
        unitCount: Math.max(remaining, 0),
      });
    } else if (item.model) {
      const modelKey = item.model.name + (item.model.modelNumber ? ` - ${item.model.modelNumber}` : "");
      // Items in different containers must be in separate groups
      const containerSuffix = `\0${item.prepContainer || ""}`;
      const key = modelKey + containerSuffix;
      const existing = serializedByModel.get(key);
      if (existing) {
        existing.push(item);
      } else {
        const arr = [item];
        serializedByModel.set(key, arr);
        result.push({ kind: "serialized-group", groupKey: `ser-in-${key}`, modelName: modelKey, items: arr });
      }
    } else {
      result.push({ kind: "single", item });
    }
  }

  return result.map((e) => {
    if (e.kind === "serialized-group" && e.items.length === 1) {
      return { kind: "single" as const, item: e.items[0] };
    }
    if (e.kind === "bulk-group" && e.unitCount <= 1 && e.unitCount === e.item.quantity) {
      return { kind: "single" as const, item: e.item };
    }
    return e;
  });
}
