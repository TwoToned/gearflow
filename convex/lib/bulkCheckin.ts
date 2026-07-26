/**
 * Pure bulk-check-in grouping/distribution helpers — Convex copy of the relevant
 * parts of src/lib/bulk-checkin.ts (Convex can't import from src/). Keep in sync.
 */
export type CheckInItemType = "OWNED_SERIALISED" | "OWNED_BULK" | "SUBHIRE" | "CUSTOM" | "ACCESSORY";

export interface CheckInItem {
  lineItemId: string;
  modelId: string | null;
  modelName: string | null;
  modelNumber: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  subHireId: string | null;
  isCustomItem: boolean;
  childKind: string | null;
  sortOrder: number;
  outstanding: number;
  itemType: CheckInItemType;
}

export interface Allocation {
  lineItemId: string;
  assetId: string | null;
  bulkAssetId: string | null;
  itemType: CheckInItemType;
  quantity: number;
}

export interface DistributionResult {
  allocations: Allocation[];
  distributed: number;
  requested: number;
}

export function itemGroupKey(item: CheckInItem): string | null {
  if (item.childKind === "ACCESSORY") {
    if (item.bulkAssetId) return `bulk:${item.bulkAssetId}`;
    if (item.assetId && item.modelId) return `serial:${item.modelId}`;
    return null;
  }
  if (item.subHireId) return `subhire:${item.lineItemId}`;
  if (item.isCustomItem) return `custom:${item.lineItemId}`;
  if (item.assetId && !item.bulkAssetId) return `asset:${item.assetId}`;
  if (item.bulkAssetId) return `bulk:${item.bulkAssetId}`;
  return null;
}

export function distributeReturn(children: CheckInItem[], quantity: number): DistributionResult {
  const requested = Math.max(0, Math.floor(quantity));
  const allocations: Allocation[] = [];
  let remaining = requested;
  const ordered = [...children].sort((a, b) => a.sortOrder - b.sortOrder || a.lineItemId.localeCompare(b.lineItemId));
  for (const child of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, child.outstanding));
    if (take <= 0) continue;
    allocations.push({ lineItemId: child.lineItemId, assetId: child.assetId, bulkAssetId: child.bulkAssetId, itemType: child.itemType, quantity: take });
    remaining -= take;
  }
  return { allocations, distributed: requested - remaining, requested };
}

// ─── Aggregation — ported from src/lib/bulk-checkin.ts (issue #944 WS5) ───────
// Convex can't import from src/, and the read half (aggregateCheckInTotals) never
// got its Convex copy when distributeReturn/itemGroupKey were ported alongside
// warehouseOps.checkInBulkTotals — this closes that gap so both halves of the
// bulk-check-in engine have exactly one Convex-side definition (R-3.1).

type BulkCheckInKind = "BULK" | "SERIALIZED";

export interface BulkCheckInTotal {
  key: string;
  kind: BulkCheckInKind;
  itemType: CheckInItemType;
  modelId: string | null;
  bulkAssetId: string | null;
  label: string;
  modelNumber: string | null;
  totalDue: number;
  childCount: number;
}

export function aggregateCheckInTotals(items: CheckInItem[]): BulkCheckInTotal[] {
  const groups = new Map<string, BulkCheckInTotal>();

  for (const item of items) {
    if (item.outstanding <= 0) continue;
    const key = itemGroupKey(item);
    if (!key) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.totalDue += item.outstanding;
      existing.childCount += 1;
      continue;
    }

    groups.set(key, {
      key,
      kind: item.bulkAssetId ? "BULK" : "SERIALIZED",
      itemType: item.itemType,
      modelId: item.modelId,
      bulkAssetId: item.bulkAssetId,
      label: item.modelName ?? (item.itemType === "ACCESSORY" ? "Accessory" : "Item"),
      modelNumber: item.modelNumber,
      totalDue: item.outstanding,
      childCount: 1,
    });
  }

  return [...groups.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
  );
}

/**
 * A project-scoped grouping key — `itemGroupKey` prefixed with the owning
 * project's id. The org-wide returns station (WS5, issue #944) resolves a bulk
 * tag scan across EVERY project at once, so grouping must not merge two
 * different projects' outstanding quantities under the same bare identity key
 * (e.g. two projects both holding "bulk:cable-xlr-5m" would otherwise collapse
 * into one `distributeReturn` pool and let a return on project A silently draw
 * down project B's count). Reviving `distributeReturn`/`itemGroupKey` for the
 * multi-project case means keying by `(projectId, itemGroupKey)` instead.
 */
export function scopedGroupKey(projectId: string, item: CheckInItem): string | null {
  const base = itemGroupKey(item);
  return base ? `${projectId}::${base}` : null;
}
