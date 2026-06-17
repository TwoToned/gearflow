import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Asset + BulkAsset domains (Phase 3 cutover).
 *
 * Both are dual-written (see src/lib/asset-mirror.ts). Reactive reads — the
 * registry table, the asset/bulk edit forms — go through Convex via the
 * `use-assets` hooks. Cross-domain `asset.*` / `bulkAsset.*` joins (T&T, scan,
 * check, damage, line-item composition, the PDF pipeline) stay on the
 * always-fresh Prisma mirror and migrate at Prisma-decommission. See FEATUREDOCS/54.
 */
export type ConvexAsset = Doc<"assets">;
export type ConvexBulkAsset = Doc<"bulkAssets">;

export async function getAssetById(id: string): Promise<ConvexAsset | null> {
  return await (await getConvexClient()).query(api.assets.getById, { id });
}

export async function getAssetsByOrg(orgId: string): Promise<ConvexAsset[]> {
  return await (await getConvexClient()).query(api.assets.list, { orgId });
}

export async function getBulkAssetById(id: string): Promise<ConvexBulkAsset | null> {
  return await (await getConvexClient()).query(api.bulkAssets.getById, { id });
}

export async function getBulkAssetsByOrg(orgId: string): Promise<ConvexBulkAsset[]> {
  return await (await getConvexClient()).query(api.bulkAssets.list, { orgId });
}

export async function getAssetByAssetTag(orgId: string, assetTag: string): Promise<ConvexAsset | null> {
  return await (await getConvexClient()).query(api.assets.getByAssetTag, { organizationId: orgId, assetTag });
}

export async function getBulkAssetByAssetTag(orgId: string, assetTag: string): Promise<ConvexBulkAsset | null> {
  return await (await getConvexClient()).query(api.bulkAssets.getByAssetTag, { organizationId: orgId, assetTag });
}

export async function getActiveAssetsByModel(modelId: string, orgId: string): Promise<ConvexAsset[]> {
  const all = (await (await getConvexClient()).query(api.assets.listByModel, { modelId, orgId })) as ConvexAsset[];
  return all.filter((a) => a.isActive !== false);
}

export async function getActiveBulkAssetsByModel(modelId: string, orgId: string): Promise<ConvexBulkAsset[]> {
  const all = (await (await getConvexClient()).query(api.bulkAssets.listByModel, { modelId, orgId })) as ConvexBulkAsset[];
  return all.filter((ba) => ba.isActive !== false);
}

// ---------------------------------------------------------------------------
// Pure filter/sort predicates (unit-tested) replicating the Prisma `where` /
// `orderBy` clauses of the kit-availability and container-search reads now that
// the asset rows come off Convex. Prisma defaults are coerced because the Convex
// doc leaves defaulted columns absent: `status` (Asset default AVAILABLE /
// BulkAsset default ACTIVE), `isActive` (default true), `availableQuantity`
// (default 0). `assetTag` is a required non-null column, so the ASC sort never
// hits NULLS-LAST.
// ---------------------------------------------------------------------------

/** Stable ASC sort by `assetTag` (Prisma `orderBy: { assetTag: "asc" }`). */
export function sortByAssetTagAsc<T extends { assetTag: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.assetTag < b.assetTag ? -1 : a.assetTag > b.assetTag ? 1 : 0));
}

/**
 * Serialized assets eligible to be added to a kit: active, AVAILABLE, not already
 * in a kit, optionally filtered to one model. Replicates
 * `where: { isActive: true, status: "AVAILABLE", kitId: null, ...(modelId && { modelId }) }`.
 */
export function filterAvailableAssetsForKit(assets: ConvexAsset[], modelId?: string): ConvexAsset[] {
  return assets.filter(
    (a) =>
      a.isActive !== false &&
      (a.status ?? "AVAILABLE") === "AVAILABLE" &&
      (a.kitId ?? null) === null &&
      (!modelId || a.modelId === modelId),
  );
}

/**
 * Bulk assets eligible to be added to a kit: active, ACTIVE status, with spare
 * quantity. Replicates
 * `where: { isActive: true, status: "ACTIVE", availableQuantity: { gt: 0 } }`.
 */
export function filterAvailableBulkAssetsForKit(bulkAssets: ConvexBulkAsset[]): ConvexBulkAsset[] {
  return bulkAssets.filter(
    (b) =>
      b.isActive !== false &&
      (b.status ?? "ACTIVE") === "ACTIVE" &&
      (b.availableQuantity ?? 0) > 0,
  );
}

/**
 * Container-search match predicate: assets whose model's category is in
 * `categoryIds`, optionally matching `query` (case-insensitive substring)
 * against `assetTag`, `customName`, or the model name. Replicates the
 * `searchContainerAssets` Prisma `where` — the `model: { categoryId: { in } }`
 * relational filter plus the OR text filter. `modelCategoryId` / `modelName`
 * resolve the joined model fields from the Convex model map; an asset whose model
 * can't be resolved fails the category gate (a join against a deleted/absent row,
 * same as Prisma's inner relational filter).
 */
export function filterContainerAssets(
  assets: ConvexAsset[],
  categoryIds: Set<string>,
  query: string,
  modelCategoryId: (modelId: string | null | undefined) => string | null,
  modelName: (modelId: string | null | undefined) => string | null,
): ConvexAsset[] {
  const needle = query.toLowerCase();
  return assets.filter((a) => {
    const catId = modelCategoryId(a.modelId);
    if (!catId || !categoryIds.has(catId)) return false;
    if (!needle) return true;
    return (
      a.assetTag.toLowerCase().includes(needle) ||
      (a.customName?.toLowerCase().includes(needle) ?? false) ||
      (modelName(a.modelId)?.toLowerCase().includes(needle) ?? false)
    );
  });
}
