import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  type ConvexAsset,
  type ConvexBulkAsset,
  getAssetsByOrg,
  getBulkAssetsByOrg,
} from "@/lib/assets-read";
import { getModelMap, type ConvexModel } from "@/lib/models-read";

/**
 * Convex read layer for the Stocktake domain (Phase A read-rewiring). The
 * `stocktake` + `stocktakeItem` rows are dual-written to Convex; this replaces the
 * `prisma.stocktake.findMany/findUnique` reads behind the stocktake list / detail /
 * progress / recent-scans / search server actions. `asset` / `bulkAsset` (+ their
 * `model`) are attached from the Convex mirrors; `location` is attached by the
 * caller from its location map; `startedBy` / `reviewedBy` are Better Auth Users
 * and stay Prisma (attached by the caller — not a violation).
 *
 * Convex dates are epoch-ms → mapped to `Date`. No Prisma fallback on a miss.
 */

type StocktakeDoc = Doc<"stocktakes">;
type StocktakeItemDoc = Doc<"stocktakeItems">;

function msToDate(n: number | null | undefined): Date | null {
  return n == null ? null : new Date(n);
}

export interface MappedStocktake {
  id: string;
  organizationId: string;
  name: string;
  locationId: string;
  scope: string;
  categoryId: string | null;
  status: string;
  startedAt: Date | null;
  startedById: string | null;
  completedAt: Date | null;
  reviewedById: string | null;
  expectedCount: number;
  foundCount: number;
  missingCount: number;
  unexpectedCount: number;
  discrepancyCount: number;
  notes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function mapStocktake(d: StocktakeDoc): MappedStocktake {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    locationId: d.locationId,
    scope: d.scope,
    categoryId: d.categoryId ?? null,
    status: d.status ?? "DRAFT",
    startedAt: msToDate(d.startedAt),
    startedById: d.startedById ?? null,
    completedAt: msToDate(d.completedAt),
    reviewedById: d.reviewedById ?? null,
    expectedCount: d.expectedCount ?? 0,
    foundCount: d.foundCount ?? 0,
    missingCount: d.missingCount ?? 0,
    unexpectedCount: d.unexpectedCount ?? 0,
    discrepancyCount: d.discrepancyCount ?? 0,
    notes: d.notes ?? null,
    createdAt: msToDate(d.createdAt),
    updatedAt: msToDate(d.updatedAt),
  };
}

export interface MappedStocktakeItem {
  id: string;
  stocktakeId: string;
  assetId: string | null;
  bulkAssetId: string | null;
  expectedAtLocation: boolean;
  expectedQuantity: number;
  found: boolean;
  foundQuantity: number;
  scannedAt: Date | null;
  scannedById: string | null;
  result: string;
  conditionNote: string | null;
  actionTaken: string | null;
}

export function mapStocktakeItem(d: StocktakeItemDoc): MappedStocktakeItem {
  return {
    id: d.id,
    stocktakeId: d.stocktakeId,
    assetId: d.assetId ?? null,
    bulkAssetId: d.bulkAssetId ?? null,
    expectedAtLocation: d.expectedAtLocation ?? true,
    expectedQuantity: d.expectedQuantity ?? 1,
    found: d.found ?? false,
    foundQuantity: d.foundQuantity ?? 0,
    scannedAt: msToDate(d.scannedAt),
    scannedById: d.scannedById ?? null,
    result: d.result ?? "MATCH",
    conditionNote: d.conditionNote ?? null,
    actionTaken: d.actionTaken ?? null,
  };
}

/** Fetch + map all stocktakes for an org (caller filters/sorts/paginates in JS). */
export async function getStocktakesByOrg(orgId: string): Promise<MappedStocktake[]> {
  const docs = await (await getConvexClient()).query(api.stocktakes.list, { orgId });
  return docs.map(mapStocktake);
}

/** Fetch + map a single stocktake by cuid (org-checked by the caller). */
export async function getStocktakeByIdConvex(id: string): Promise<MappedStocktake | null> {
  const doc = await (await getConvexClient()).query(api.stocktakes.getById, { id });
  return doc ? mapStocktake(doc) : null;
}

/** Fetch + map a stocktake's items by stocktakeId. */
export async function getStocktakeItemsConvex(stocktakeId: string): Promise<MappedStocktakeItem[]> {
  const docs = await (await getConvexClient()).query(api.stocktakeItems.list, { stocktakeId });
  return docs.map(mapStocktakeItem);
}

/** An asset/bulk-asset doc with its `model` resolved (matches the old
 *  `asset: { include: { model } }` shape the stocktake UI reads). */
type AssetWithModel = (ConvexAsset | ConvexBulkAsset) & { model: ConvexModel | null };

/** A stocktake item with `asset` / `bulkAsset` (+ each one's `model`) attached. */
export type StocktakeItemWithAssets = MappedStocktakeItem & {
  asset: AssetWithModel | null;
  bulkAsset: AssetWithModel | null;
};

/**
 * Attach `asset` / `bulkAsset` (+ nested `model`) from the Convex mirrors onto a
 * batch of stocktake items. One round-trip per org. A miss yields `null` (no
 * Prisma fallback). Replaces the Prisma `asset`/`bulkAsset` joins + the old
 * `attachStocktakeModels` model graft.
 */
export async function attachStocktakeItemAssets(
  orgId: string,
  items: MappedStocktakeItem[],
): Promise<StocktakeItemWithAssets[]> {
  const [assetArr, bulkArr, modelMap] = await Promise.all([
    getAssetsByOrg(orgId),
    getBulkAssetsByOrg(orgId),
    getModelMap(orgId),
  ]);
  const assetMap = new Map(assetArr.map((a) => [a.id, a]));
  const bulkAssetMap = new Map(bulkArr.map((b) => [b.id, b]));
  const withModel = (a: ConvexAsset | ConvexBulkAsset | undefined): AssetWithModel | null =>
    a ? { ...a, model: a.modelId ? modelMap.get(a.modelId) ?? null : null } : null;
  return items.map((it) => ({
    ...it,
    asset: it.assetId ? withModel(assetMap.get(it.assetId)) : null,
    bulkAsset: it.bulkAssetId ? withModel(bulkAssetMap.get(it.bulkAssetId)) : null,
  }));
}
