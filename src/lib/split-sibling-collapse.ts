/**
 * Pure helpers for the Phase 3.8 split-sibling collapse migration.
 *
 * See docs/designs/line-item-fulfillment-model.md (Phase 2b).
 *
 * The historic data contains `ProjectLineItem` rows that the retired
 * `splitLineItem` function fragmented into per-asset qty-1 siblings.
 * Post-cutover this is the wrong shape — a `10x SM57` order line should
 * be ONE row with ten `ProjectLineItemUnit` rows, not ten lines.
 *
 * The collapse migration merges sibling rows back onto one canonical
 * order line under a STRICT full-equivalence key — every order-level
 * field identical. Anything that doesn't match is flagged, not merged.
 *
 * This module only computes the *plan*: which rows merge into which,
 * which groups are mergeable, and which are flagged. The DB mutation
 * (move units, repoint CheckRecord, deactivate old rows,
 * write `LineItemMergeMap`) is the script's job.
 *
 * Lives outside `"use server"` so the script and unit tests drive it
 * directly without a session.
 */

/**
 * Decimal-ish stringifier. Prisma returns Decimal objects; tests pass
 * strings or numbers. Normalise to a string with a trailing zero
 * trimmed, or null. `0` and `0.00` collapse to the same key — important
 * because price equality must not depend on display formatting.
 */
function normDecimal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  // Prisma Decimal has toString(); plain number / string both work.
  const s = String(v);
  // Strip trailing zeros after decimal, then a dangling dot.
  if (s.includes(".")) return s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/**
 * The minimum row shape `equivalenceKey` + `planGroup` need. Mirrors
 * `ProjectLineItem` fields exactly; using a subset lets unit tests skip
 * the Prisma client. Decimal-typed fields accept `unknown` so callers
 * can pass Prisma Decimal | string | number.
 */
export interface CollapseRow {
  id: string;
  organizationId: string;
  projectId: string;
  type: string;
  modelId: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  kitId: string | null;
  isKitChild: boolean;
  parentLineItemId: string | null;
  pricingMode: string | null;
  description: string | null;
  quantity: number;
  unitPrice: unknown;
  pricingType: string;
  duration: number;
  discount: unknown;
  priceOverridden: boolean;
  overrideReason: string | null;
  sortOrder: number;
  groupName: string | null;
  categoryId: string | null;
  groupId: string | null;
  notes: string | null;
  isOptional: boolean;
  isContainerLineItem: boolean;
  isCustomItem: boolean;
  showSubhireOnDocs: boolean;
  supplierId: string | null;
  subhireOrderNumber: string | null;
  supplierOrderId: string | null;
  subHireId: string | null;
  subHireItemId: string | null;
  subHireGroupId: string | null;
  createdAt: Date;
}

/**
 * The strict full-equivalence key. Two rows are mergeable only if their
 * keys are byte-identical.
 *
 * Deliberately EXCLUDED:
 *  - `id`, `createdAt`, `updatedAt` — instance identity.
 *  - `quantity` — siblings of a `10x` split each carry `1`, but it's
 *    exactly what we're summing.
 *  - `assetId`, `bulkAssetId` — what makes them split-siblings, not what
 *    makes them mergeable. Each sibling has a different one.
 *  - `sortOrder` — splits re-numbered it; the canonical row's order is
 *    what survives.
 *  - rollup counters (`assignedQuantity` / `packedQuantity` / etc.) —
 *    derived state, will be recomputed post-merge.
 *  - lifecycle (`status`, `checkedOutAt`, `returnedAt`, `returnCondition`,
 *    `returnStatus`, `returnNotes`, `prepStatus`, `prepContainer`) — also
 *    per-unit state; the unit table is the source of truth post-cutover.
 *  - `lineTotal`, `priceBreakdown` — derived from unitPrice + duration +
 *    quantity + discount; recomputed naturally when quantity sums.
 *  - `isOptional`-but-equal across siblings is included.
 *
 * INCLUDED — every order-level identity field. Differ on any of these
 * and the rows are commercially different lines that must not merge.
 */
export function equivalenceKey(row: CollapseRow): string {
  const obj = {
    projectId: row.projectId,
    type: row.type,
    modelId: row.modelId,
    kitId: row.kitId,
    isKitChild: row.isKitChild,
    parentLineItemId: row.parentLineItemId,
    pricingMode: row.pricingMode,
    description: row.description,
    unitPrice: normDecimal(row.unitPrice),
    pricingType: row.pricingType,
    duration: row.duration,
    discount: normDecimal(row.discount),
    priceOverridden: row.priceOverridden,
    overrideReason: row.overrideReason,
    groupName: row.groupName,
    categoryId: row.categoryId,
    groupId: row.groupId,
    notes: row.notes,
    isOptional: row.isOptional,
    isContainerLineItem: row.isContainerLineItem,
    isCustomItem: row.isCustomItem,
    showSubhireOnDocs: row.showSubhireOnDocs,
    supplierId: row.supplierId,
    subhireOrderNumber: row.subhireOrderNumber,
    supplierOrderId: row.supplierOrderId,
    subHireId: row.subHireId,
    subHireItemId: row.subHireItemId,
    subHireGroupId: row.subHireGroupId,
  };
  return JSON.stringify(obj);
}

/**
 * Pick the canonical row to merge siblings INTO. Smallest sortOrder
 * wins — that's the row that was at the top of the section before the
 * split. Ties broken by oldest createdAt; final tie by id (stable).
 *
 * The canonical is mutated in place (its quantity grows, its rollup
 * recomputes). Siblings are deactivated.
 */
export function pickCanonical<T extends Pick<CollapseRow, "id" | "sortOrder" | "createdAt">>(
  rows: T[],
): T {
  if (rows.length === 0) throw new Error("pickCanonical: empty input");
  return [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const at = a.createdAt.getTime();
    const bt = b.createdAt.getTime();
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

export interface PlannedMove {
  /** The sibling row that will be deactivated. */
  siblingId: string;
  /** Asset the sibling holds (one of assetId / bulkAssetId is set). */
  assetId: string | null;
  bulkAssetId: string | null;
  /** Quantity added to the canonical. */
  quantity: number;
}

export interface GroupPlan {
  key: string;
  canonicalId: string;
  moves: PlannedMove[];
  /** Reasons this group was flagged. Empty == mergeable. */
  flags: string[];
}

/**
 * Plan a single equivalence-key group. Returns the canonical, the
 * sibling moves, and any flags. A group with flags is NOT merged — the
 * script reports it and moves on.
 *
 * Mergeability invariants:
 *   - ≥ 2 rows in the group.
 *   - Every row has either `assetId` or `bulkAssetId` set (otherwise
 *     it's a generic order line, not a split sibling).
 *   - No two rows share an `assetId` (a split is one-asset-per-row).
 *   - All rows in the group share the same equivalence key (caller's
 *     responsibility — we trust the grouping).
 */
export function planGroup(rows: CollapseRow[]): GroupPlan {
  const key = rows[0] ? equivalenceKey(rows[0]) : "";
  const flags: string[] = [];

  if (rows.length < 2) {
    return { key, canonicalId: rows[0]?.id ?? "", moves: [], flags: ["single-row-group"] };
  }

  // Every row in a split-sibling set must carry an asset. A row with
  // neither asset nor bulkAsset is a generic order line — not the kind
  // splitLineItem produced.
  const allHaveAsset = rows.every((r) => r.assetId || r.bulkAssetId);
  if (!allHaveAsset) flags.push("row-without-asset-or-bulk");

  // Duplicate assets across siblings — schema-impossible after the
  // ProjectLineItemUnit unique constraint lands, but historic split
  // siblings predate that. Defensive guard.
  const seenAssetIds = new Set<string>();
  for (const r of rows) {
    if (!r.assetId) continue;
    if (seenAssetIds.has(r.assetId)) {
      flags.push(`duplicate-asset-${r.assetId}`);
    }
    seenAssetIds.add(r.assetId);
  }

  // Kit children get collapsed at most one row, so a group of ≥ 2 kit
  // children with the same parent would already be wrong. Flag and
  // skip.
  if (rows.some((r) => r.isKitChild)) flags.push("kit-children-in-group");

  const canonical = pickCanonical(rows);
  const moves: PlannedMove[] = [];
  if (flags.length === 0) {
    for (const r of rows) {
      if (r.id === canonical.id) continue;
      moves.push({
        siblingId: r.id,
        assetId: r.assetId,
        bulkAssetId: r.bulkAssetId,
        quantity: r.quantity,
      });
    }
  }
  return { key, canonicalId: canonical.id, moves, flags };
}

/**
 * Bucket a flat list of rows by their equivalence key, then plan each
 * bucket. Groups of size 1 are dropped — they have nothing to merge.
 */
export function planAll(rows: CollapseRow[]): GroupPlan[] {
  const byKey = new Map<string, CollapseRow[]>();
  for (const r of rows) {
    const k = equivalenceKey(r);
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }
  const plans: GroupPlan[] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    plans.push(planGroup(group));
  }
  return plans;
}
