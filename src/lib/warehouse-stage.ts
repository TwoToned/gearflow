/**
 * Warehouse stage model — the single source of truth for which lifecycle
 * stage(s) a warehouse line item belongs to.
 *
 * The per-project warehouse board presents gear as a left-to-right pipeline:
 *
 *   Pick/Prep ─▶ Prepped ─▶ Deployed ─▶ Returned ─▶ Depreped
 *
 * A line is NOT in exactly one stage. The fulfillment model is unit-level, so a
 * single order line can occupy several stages at once:
 *   - a bulk line of 10 with 6 still out and 4 back is DEPLOYED(6) + RETURNED(4)
 *   - a kit parent renders in every stage where it has a child
 * `stagesForItem` therefore returns a Map of stage → quantity, and
 * `belongsInStage` is the predicate the tab/board filters call.
 *
 * Why this exists (see docs/designs/warehouse-linear-flow.md):
 *   1. Returned gear used to leak back into Pick/Prep (it looked like it never
 *      shipped). RETURNED is now its own stage; Pick/Prep never contains it.
 *   2. Deprep is the forward Returned → Depreped step. Depreped = returned gear
 *      put away (prepStatus PENDING); Returned = back but not yet put away
 *      (prepStatus PACKED or a FLAGGED_* override, which must NOT vanish).
 *   3. Deployed/Returned key on quantities, not the coarse line `status` (which
 *      reports CHECKED_OUT while any unit is still out), so partial returns show
 *      in both Deployed and Returned.
 *
 * Pure + structural input so it unit-tests without a DB and is reused by every
 * tab/board filter and count badge.
 */

export type WarehouseStage =
  | "PICK_PREP"
  | "PREPPED"
  | "DEPLOYED"
  | "RETURNED"
  | "DEPREPED";

/** Left-to-right order of the lifecycle stages. */
export const WAREHOUSE_STAGE_ORDER: readonly WarehouseStage[] = [
  "PICK_PREP",
  "PREPPED",
  "DEPLOYED",
  "RETURNED",
  "DEPREPED",
] as const;

/**
 * Minimal structural shape the stage model needs. `LineItem` (and the Prisma
 * row) satisfy it structurally — we keep it narrow so the helper is decoupled
 * and trivially testable.
 */
export interface StageLineLike {
  status: string;
  prepStatus: string | null;
  /** Remaining ordered units on this line row (decremented as serialized units
   *  split off at prep time; the ordered total for a bulk line). */
  quantity: number;
  /** Denormalised rollup: units currently out (not yet returned). */
  checkedOutQuantity: number;
  /** Denormalised rollup: units that have come back. */
  returnedQuantity: number;
  kitId?: string | null;
  isKitChild?: boolean;
  childLineItems?: StageLineLike[] | null;
}

function isKitParentLike(item: StageLineLike): boolean {
  return !!item.kitId && !item.isKitChild;
}

function isGroupParentLike(item: StageLineLike): boolean {
  return (
    !item.isKitChild &&
    !item.kitId &&
    (item.childLineItems?.length ?? 0) > 0
  );
}

function addQty(map: Map<WarehouseStage, number>, stage: WarehouseStage, qty: number) {
  if (qty <= 0) return;
  map.set(stage, (map.get(stage) ?? 0) + qty);
}

/**
 * Stage membership for a single LEAF line (no kit/group children). Returns the
 * quantity sitting in each stage. A line can land in multiple stages.
 */
function leafStages(item: StageLineLike): Map<WarehouseStage, number> {
  const stages = new Map<WarehouseStage, number>();
  if (item.status === "CANCELLED") return stages;

  // Units still out vs come back, from the rollup counters (quantity-aware so
  // partial returns split across Deployed and Returned).
  const stillOut = Math.max(0, item.checkedOutQuantity - item.returnedQuantity);
  // A fully-returned serialized split line carries returnedQuantity=1; guard the
  // rollup edge where status flipped to RETURNED but the counter lagged.
  const cameBack =
    item.returnedQuantity > 0
      ? item.returnedQuantity
      : item.status === "RETURNED"
        ? Math.max(item.quantity, 1)
        : 0;

  // Depreped = put away (prepStatus reset to PENDING). Returned = back but not
  // yet put away (still PACKED, or a FLAGGED_* override — never let those vanish).
  const putAway = item.prepStatus === "PENDING";

  if (stillOut > 0) addQty(stages, "DEPLOYED", stillOut);
  if (cameBack > 0) addQty(stages, putAway ? "DEPREPED" : "RETURNED", cameBack);

  // Prepped = packed and staged, not yet deployed and not a returned line.
  // quantity > 0 mirrors the deploy tab's `if (item.quantity <= 0) return false`
  // guard so an exhausted split original (qty 0) shows nothing.
  if (
    item.prepStatus === "PACKED" &&
    item.quantity > 0 &&
    item.status !== "CHECKED_OUT" &&
    item.status !== "RETURNED"
  ) {
    addQty(stages, "PREPPED", item.quantity);
  }

  // Pick/Prep = still needs picking/packing. Crucially NOT for RETURNED items
  // (the old leak) and not for already-packed or deployed ones.
  if (
    item.quantity > 0 &&
    item.status !== "CHECKED_OUT" &&
    item.status !== "RETURNED" &&
    item.prepStatus !== "PACKED"
  ) {
    addQty(stages, "PICK_PREP", item.quantity);
  }

  return stages;
}

/**
 * Stage membership for any line, aggregating children for kit/group parents.
 * A kit or sub-hire group parent renders in every stage where it has a
 * descendant, so its quantities are the union (sum) of its children's.
 */
export function stagesForItem(item: StageLineLike): Map<WarehouseStage, number> {
  // Aggregate over children for any container node: a top-level kit/sub-hire
  // group parent, OR a nested kit child (kitId set, isKitChild true) that has
  // its own grandchildren. Such a node is represented by its descendants, never
  // its own line.
  const hasChildren = (item.childLineItems?.length ?? 0) > 0;
  const isContainer =
    hasChildren && (!!item.kitId || isGroupParentLike(item) || isKitParentLike(item));
  if (isContainer) {
    const merged = new Map<WarehouseStage, number>();
    for (const child of item.childLineItems ?? []) {
      for (const [stage, qty] of stagesForItem(child)) {
        addQty(merged, stage, qty);
      }
    }
    return merged;
  }
  return leafStages(item);
}

/** Does this line belong in the given stage (at the line or any descendant)? */
export function belongsInStage(item: StageLineLike, stage: WarehouseStage): boolean {
  return (stagesForItem(item).get(stage) ?? 0) > 0;
}

/** Total units of this line sitting in the given stage (0 if none). */
export function stageQuantity(item: StageLineLike, stage: WarehouseStage): number {
  return stagesForItem(item).get(stage) ?? 0;
}
