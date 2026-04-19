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
  parentLineItemId: string | null;
  model: { name: string; modelNumber?: string | null; assetType?: string; _count?: { modelCheckItems: number } } | null;
  asset: { assetTag: string } | null;
  bulkAsset: { assetTag: string } | null;
  kit: { id: string; assetTag: string; name: string; checkMode?: string; _count?: { kitCheckItems: number } } | null;
  prepStatus: string | null;
  prepContainer: string | null;
  isContainerLineItem: boolean;
  isCustomItem: boolean;
  isSubhire: boolean;
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
  | { kind: "kit-group"; groupKey: string; item: LineItem; children: LineItem[] };

// "Bulk" means: a multi-unit line item without individual serialized assets.
export function isBulkItem(item: LineItem) {
  if (item.quantity <= 1) return false;
  if (item.bulkAssetId) return true;
  if (!item.assetId) return true;
  return false;
}

export function modelDisplayName(item: LineItem) {
  if (!item.model) return item.description || "Unnamed item";
  return [item.model.name, item.model.modelNumber].filter(Boolean).join(" - ");
}

export function isKitParent(item: LineItem) {
  return !!item.kitId && !item.isKitChild;
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
