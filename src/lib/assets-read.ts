import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Asset + BulkAsset domains (Phase 3 cutover).
 *
 * Both are dual-written (see src/lib/asset-mirror.ts). Reactive reads — the
 * registry table, the asset/bulk edit forms — go through Convex via the
 * `use-assets` hooks. Cross-domain `asset.*` / `bulkAsset.*` joins (T&T, scan,
 * check, damage, stocktake, line-item composition, the PDF pipeline) stay on the
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
