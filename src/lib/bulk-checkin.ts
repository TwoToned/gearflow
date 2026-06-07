export type CheckInItemType = "OWNED_SERIALISED" | "OWNED_BULK" | "SUBHIRE" | "CUSTOM" | "ACCESSORY";

export type BulkCheckInKind = "BULK" | "SERIALIZED";

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
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key),
  );
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

export function distributeReturn(
  children: CheckInItem[],
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
      itemType: child.itemType,
      quantity: take,
    });
    remaining -= take;
  }

  return { allocations, distributed: requested - remaining, requested };
}
