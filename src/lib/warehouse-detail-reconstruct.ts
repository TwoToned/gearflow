/**
 * CLIENT-SAFE reconstruction of getProjectForWarehouse's
 * `{ ...project, lineItems, client, location }` from the ONE `warehouseDetail.bundle`
 * subscription. Zero server imports.
 *
 * The line-item tree is `buildWarehouseLineItems` reproduced client-side: a FLAT
 * `type === "EQUIPMENT"` tree (depth 2, keep cancelled) with units, then the
 * warehouse attach pipeline — model/supplier → model check-item count → kit (+
 * count) → asset/bulkAsset on BOTH lines AND units. The three check-item / asset
 * attach helpers are COPIES of the pure ones in line-item-tree-read.ts (which keep
 * server-only co-residents) — keep them in sync.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { ConvexAsset, ConvexBulkAsset } from "@/lib/assets-read";
import type { ConvexKit } from "@/lib/kits-read";
import type { ConvexModel } from "@/lib/models-read";
import type { ConvexSupplier } from "@/lib/suppliers-read";
import type { ConvexCategory } from "@/lib/categories-read";
import type {
  AttachedModel,
  LineItemAttachMaps,
} from "@/lib/project-equipment-reconstruct";
import {
  mapLineItemDoc,
  mapUnitDoc,
  attachLineItemTree,
} from "@/lib/project-equipment-reconstruct";
import {
  indexChildren,
  indexUnits,
  reconstructScope,
} from "@/lib/project-line-item-tree-read";
import { mapProject } from "@/lib/project-detail-reconstruct";

/** The raw-doc bundle `warehouseDetail.bundle` returns (non-null variant). */
export type WarehouseBundleData = NonNullable<FunctionReturnType<typeof api.warehouseDetail.bundle>>;

// ─── Attach helpers (copies of line-item-tree-read.ts pure helpers) ──────────

type ModelWithCheckCount = AttachedModel & { _count: { modelCheckItems: number } };
type KitWithCheckCount = ConvexKit & { _count: { kitCheckItems: number } };

type ModelNode = { model: AttachedModel | null; childLineItems?: unknown };

/** Graft `_count.modelCheckItems` onto every attached `model` node (recursive). */
function attachModelCheckItemCounts<T extends ModelNode>(
  rows: T[],
  countByModelId: Map<string, number>,
): Array<Omit<T, "model"> & { model: ModelWithCheckCount | null }> {
  return rows.map((row) => {
    const children = row.childLineItems;
    const model: ModelWithCheckCount | null = row.model
      ? { ...row.model, _count: { modelCheckItems: countByModelId.get(row.model.id) ?? 0 } }
      : null;
    return {
      ...row,
      model,
      ...(Array.isArray(children)
        ? { childLineItems: attachModelCheckItemCounts(children as ModelNode[], countByModelId) }
        : {}),
    };
  }) as Array<Omit<T, "model"> & { model: ModelWithCheckCount | null }>;
}

type KitNode = { kitId?: string | null; childLineItems?: unknown };

/** Attach `kit` (Convex kit doc + grafted `_count.kitCheckItems`) onto every node. */
function attachKitTree<T extends KitNode>(
  rows: T[],
  kitMap: Map<string, ConvexKit>,
  kitCountMap: Map<string, number>,
): Array<Omit<T, "kit"> & { kit: KitWithCheckCount | null }> {
  return rows.map((row) => {
    const children = row.childLineItems;
    const baseKit = row.kitId ? kitMap.get(row.kitId) ?? null : null;
    const kit: KitWithCheckCount | null = baseKit
      ? { ...baseKit, _count: { kitCheckItems: kitCountMap.get(baseKit.id) ?? 0 } }
      : null;
    return {
      ...row,
      kit,
      ...(Array.isArray(children)
        ? { childLineItems: attachKitTree(children as KitNode[], kitMap, kitCountMap) }
        : {}),
    };
  }) as Array<Omit<T, "kit"> & { kit: KitWithCheckCount | null }>;
}

type AssetNode = {
  assetId?: string | null;
  bulkAssetId?: string | null;
  units?: Array<{ assetId?: string | null; bulkAssetId?: string | null }>;
  childLineItems?: unknown;
};

/** Attach `asset`/`bulkAsset` onto every node AND every unit (recursive). */
function attachAssetBulkAssetTree<T extends AssetNode>(
  rows: T[],
  assetMap: Map<string, ConvexAsset>,
  bulkAssetMap: Map<string, ConvexBulkAsset>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows as any[]).map((row: any) => {
    const children = row.childLineItems;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const units = ((row.units ?? []) as any[]).map((u: any) => ({
      ...u,
      asset: u.assetId ? assetMap.get(u.assetId) ?? null : null,
      bulkAsset: u.bulkAssetId ? bulkAssetMap.get(u.bulkAssetId) ?? null : null,
    }));
    return {
      ...row,
      asset: row.assetId ? assetMap.get(row.assetId) ?? null : null,
      bulkAsset: row.bulkAssetId ? bulkAssetMap.get(row.bulkAssetId) ?? null : null,
      units,
      ...(Array.isArray(children)
        ? { childLineItems: attachAssetBulkAssetTree(children as AssetNode[], assetMap, bulkAssetMap) }
        : {}),
    };
  });
}

// ─── Reconstruction ──────────────────────────────────────────────────────────

/** getProjectForWarehouse's line items, reproduced from the bundle's raw docs. */
export function reconstructWarehouseLineItems(bundle: WarehouseBundleData) {
  const lineItems = bundle.lineItems.map(mapLineItemDoc);
  const units = bundle.units.map(mapUnitDoc);

  const attachMaps: LineItemAttachMaps = {
    models: new Map(bundle.models.map((m) => [m.id, m as unknown as ConvexModel])),
    suppliers: new Map(bundle.suppliers.map((s) => [s.id, s as unknown as ConvexSupplier])),
    categories: new Map(bundle.orgCategories.map((c) => [c.id, c as unknown as ConvexCategory])),
  };
  const kitMap = new Map(bundle.kits.map((k) => [k.id, k as unknown as ConvexKit]));
  const assetMap = new Map(bundle.assets.map((a) => [a.id, a as unknown as ConvexAsset]));
  const bulkAssetMap = new Map(bundle.bulkAssets.map((b) => [b.id, b as unknown as ConvexBulkAsset]));
  const modelCountMap = new Map(Object.entries(bundle.modelCheckCounts));
  const kitCountMap = new Map(Object.entries(bundle.kitCheckCounts));

  const unitsByLineItem = indexUnits(units);
  const byParent = indexChildren(lineItems, true); // keep CANCELLED children
  const scope = lineItems.filter((li) => li.type === "EQUIPMENT");
  const tree = reconstructScope(scope, byParent, {
    unitsByLineItem,
    depth: 2,
    keepCancelled: true,
  });

  const withModelSupplier = attachLineItemTree(tree, attachMaps);
  const withModelCount = attachModelCheckItemCounts(withModelSupplier as never[], modelCountMap);
  const withKits = attachKitTree(withModelCount as never[], kitMap, kitCountMap);
  return attachAssetBulkAssetTree(withKits as never[], assetMap, bulkAssetMap);
}

export interface SaleItemToPrep {
  id: string;
  description: string | null;
  quantity: number;
  sku: string | null;
  modelName: string | null;
  picked: boolean;
}

/**
 * NEW_STOCK sale lines that need to be picked off the shelf before the job goes
 * out — a deliberately SEPARATE, self-contained list from `reconstructWarehouseLineItems`'s
 * `type === "EQUIPMENT"` scan/kit tree (2026-08 warehouse sales-prep split; see
 * FEATUREDOCS/67). Picked by SKU, not asset tag — a NEW_STOCK sale line has no
 * underlying asset/bulk record to scan. FROM_RENTAL_STOCK sale lines are NOT
 * included here — they stay out of the warehouse tree entirely, unchanged, per the
 * original #950 "handed over at the docket" decision (only the NEW_STOCK half of
 * that decision was reversed).
 */
export function reconstructSaleItemsToPrep(bundle: WarehouseBundleData): SaleItemToPrep[] {
  const lineItems = bundle.lineItems.map(mapLineItemDoc);
  const modelMap = new Map(bundle.models.map((m) => [m.id, m]));
  return lineItems
    .filter((li) => li.type === "SALE" && li.saleMode === "NEW_STOCK" && li.status !== "CANCELLED")
    .map((li) => {
      const model = li.modelId ? (modelMap.get(li.modelId) ?? null) : null;
      return {
        id: li.id,
        description: li.description,
        quantity: li.quantity,
        sku: model?.sku ?? null,
        modelName: model?.name ?? null,
        picked: li.salePickedAt != null,
      };
    });
}

export type NativeWarehouseProject = ReturnType<typeof mapProject> & {
  lineItems: ReturnType<typeof reconstructWarehouseLineItems>;
  saleItemsToPrep: SaleItemToPrep[];
  client: WarehouseBundleData["client"];
  location: WarehouseBundleData["location"];
};

/**
 * The full getProjectForWarehouse-shaped object: project scalars + the warehouse
 * line-item tree + client + location. Parity-by-construction with the server read
 * (same attach pipeline, same filters).
 */
export function reconstructWarehouseProject(
  bundle: WarehouseBundleData,
): NativeWarehouseProject {
  return {
    ...mapProject(bundle.project),
    lineItems: reconstructWarehouseLineItems(bundle),
    saleItemsToPrep: reconstructSaleItemsToPrep(bundle),
    client: bundle.client,
    location: bundle.location,
  };
}
