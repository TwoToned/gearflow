import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Kit domain (Phase 3 cutover).
 *
 * Kits (and their member sub-tables) are dual-written like Models/Suppliers:
 * every create/update/archive/delete writes BOTH the Prisma `kit` row (the
 * durable FK anchor — `kit_serialized_item`, `kit_bulk_item`, `kit_media`,
 * `kit_check_item` carry a required+Cascade FK; `asset`, `project_line_item`,
 * `asset_scan_log`, `check_record`, `maintenance_record`, `group_template_item`
 * carry nullable inbound refs) AND the Convex `kits` doc (the reactive read
 * source the browser subscribes to). Reactive reads — the kit list and the kit
 * edit form — go through Convex via the `use-kits` hooks. The cross-domain kit
 * detail page (composes assets / bulk / line items / scan logs / maintenance /
 * media, all still Prisma) stays on the always-fresh Prisma mirror via getKit.
 * See FEATUREDOCS/54.
 */
export type ConvexKit = Doc<"kits">;

export async function getKitById(id: string): Promise<ConvexKit | null> {
  return await (await getConvexClient()).query(api.kits.getById, { id });
}

export async function getKitsByOrg(orgId: string): Promise<ConvexKit[]> {
  return await (await getConvexClient()).query(api.kits.list, { orgId });
}

/** All of an org's kits keyed by cuid `id`, for attaching to joined rows. */
export async function getKitMap(orgId: string): Promise<Map<string, ConvexKit>> {
  const all = await getKitsByOrg(orgId);
  return new Map(all.map((k) => [k.id, k]));
}

export async function getKitByAssetTag(orgId: string, assetTag: string): Promise<ConvexKit | null> {
  return await (await getConvexClient()).query(api.kits.getByAssetTag, { organizationId: orgId, assetTag });
}

export type ConvexKitSerializedItem = Doc<"kitSerializedItems">;
export type ConvexKitBulkItem = Doc<"kitBulkItems">;

/** All of an org's kit serialized-member rows (kit_serialized_item), for counts. */
export async function getKitSerializedItemsByOrg(orgId: string): Promise<ConvexKitSerializedItem[]> {
  return await (await getConvexClient()).query(api.kitSerializedItems.list, { orgId });
}

/** All of an org's kit bulk-member rows (kit_bulk_item), for counts. */
export async function getKitBulkItemsByOrg(orgId: string): Promise<ConvexKitBulkItem[]> {
  return await (await getConvexClient()).query(api.kitBulkItems.list, { orgId });
}

/**
 * Per-kit member counts (kitId -> { serializedItems, bulkItems }) computed in JS
 * over the two member lists, replacing the two Prisma `groupBy({ by: ["kitId"] })`
 * calls in `getKitCounts`. A `null`/absent `kitId` is skipped (matches the Prisma
 * loop that only counts grouped rows carrying a kitId). Pure + unit-tested.
 */
export function countKitMembers(
  serializedItems: Array<{ kitId?: string | null }>,
  bulkItems: Array<{ kitId?: string | null }>,
): Record<string, { serializedItems: number; bulkItems: number }> {
  const out: Record<string, { serializedItems: number; bulkItems: number }> = {};
  const ensure = (id: string) => (out[id] ??= { serializedItems: 0, bulkItems: 0 });
  for (const s of serializedItems) if (s.kitId) ensure(s.kitId).serializedItems++;
  for (const b of bulkItems) if (b.kitId) ensure(b.kitId).bulkItems++;
  return out;
}
