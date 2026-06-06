/**
 * Bulk check-in totals — pure aggregation + distribution helpers.
 *
 * Accessory-heavy jobs (50 lights, each with 2 clamps + 1 TrueCon) are painful
 * to return per-parent: that's 150 individual check-ins. The bulk check-in
 * screen instead aggregates every deployed accessory child line item ACROSS the
 * whole project into a handful of totals ("100 clamps due back", "50 TrueCons
 * due back"). The operator counts the physical pile and checks the count in once.
 *
 * These helpers are deliberately pure (no Prisma, no IO) so the aggregation and
 * distribution rules are unit-testable in isolation. The server action in
 * `src/server/bulk-checkin.ts` does the IO and calls into here. See
 * FEATUREDOCS/52-bulk-checkin.md.
 */

export type BulkCheckInKind = "BULK" | "SERIALIZED";

/**
 * One accessory child line item reduced to the fields aggregation needs.
 * `outstanding` is the quantity still physically deployed and due back on this
 * specific child line (checked-out minus already-returned).
 */
export interface AccessoryChildInput {
  lineItemId: string;
  modelId: string | null;
  modelName: string | null;
  modelNumber: string | null;
  /** Set for a serialised accessory (one tracked asset, qty 1). */
  assetId: string | null;
  /** Set for a bulk accessory (a quantity drawn from a stock pool). */
  bulkAssetId: string | null;
  sortOrder: number;
  outstanding: number;
}

/** One aggregated total row shown on the bulk check-in screen. */
export interface BulkCheckInTotal {
  /** Stable grouping key across parents: `bulk:<id>` or `serial:<modelId>`. */
  key: string;
  kind: BulkCheckInKind;
  modelId: string | null;
  bulkAssetId: string | null;
  label: string;
  modelNumber: string | null;
  /** Sum of outstanding across every underlying child line in this group. */
  totalDue: number;
  /** How many child line items feed this total (across all parents). */
  childCount: number;
}

/**
 * The grouping key for an accessory child. Bulk accessories group by their
 * shared `bulkAssetId` (one "Clamp" pool across every light); serialised
 * accessories group by `modelId` (50 distinct TrueCon assets, one model).
 * Returns null for a child that can't be aggregated (no bulk id, no model).
 */
export function accessoryGroupKey(child: AccessoryChildInput): string | null {
  if (child.bulkAssetId) return `bulk:${child.bulkAssetId}`;
  if (child.assetId && child.modelId) return `serial:${child.modelId}`;
  return null;
}

/**
 * Aggregate accessory child line items into per-identity totals. Only children
 * with `outstanding > 0` (still deployed) contribute; a fully-returned child
 * drops out so the screen always reflects what's actually due back.
 *
 * Output is deterministically ordered (kind, then label, then key) so the UI
 * and tests see a stable row order.
 */
export function aggregateAccessoryTotals(
  children: AccessoryChildInput[],
): BulkCheckInTotal[] {
  const groups = new Map<string, BulkCheckInTotal>();

  for (const child of children) {
    if (child.outstanding <= 0) continue;
    const key = accessoryGroupKey(child);
    if (!key) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.totalDue += child.outstanding;
      existing.childCount += 1;
      continue;
    }

    groups.set(key, {
      key,
      kind: child.bulkAssetId ? "BULK" : "SERIALIZED",
      modelId: child.modelId,
      bulkAssetId: child.bulkAssetId,
      label: child.modelName ?? "Accessory",
      modelNumber: child.modelNumber,
      totalDue: child.outstanding,
      childCount: 1,
    });
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key),
  );
}

/** One unit of return work: how much to return on a specific child line. */
export interface Allocation {
  lineItemId: string;
  assetId: string | null;
  bulkAssetId: string | null;
  quantity: number;
}

export interface DistributionResult {
  allocations: Allocation[];
  /** How much was actually placed across children (≤ requested, ≤ outstanding). */
  distributed: number;
  requested: number;
}

/**
 * Distribute a requested return quantity across the child lines of ONE group,
 * deterministically: walk children in (sortOrder, lineItemId) order and fill
 * each up to its `outstanding` before moving on. This is what reconciles an
 * aggregate count back to concrete child line items.
 *
 * Never allocates more than a child's outstanding, and never more than
 * `quantity` in total — so it can't over-return even if `quantity` exceeds what
 * is deployed (the caller detects that via `distributed < requested` and
 * rejects). A non-positive `quantity` yields an empty, zero-distributed result,
 * which is what makes an empty / repeated submit a safe no-op.
 */
export function distributeReturn(
  children: AccessoryChildInput[],
  quantity: number,
): DistributionResult {
  const requested = Math.max(0, Math.floor(quantity));
  const allocations: Allocation[] = [];
  let remaining = requested;

  const ordered = [...children].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.lineItemId.localeCompare(b.lineItemId),
  );

  for (const child of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, child.outstanding));
    if (take <= 0) continue;
    allocations.push({
      lineItemId: child.lineItemId,
      assetId: child.assetId,
      bulkAssetId: child.bulkAssetId,
      quantity: take,
    });
    remaining -= take;
  }

  return { allocations, distributed: requested - remaining, requested };
}
