import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * Asset cluster — `asset` (serialized) + `bulk_asset` — is DUAL-WRITTEN: every
 * create/update/delete writes the Prisma row (the durable FK anchor) AND mirrors
 * to the matching Convex table. Prisma is written first; the Convex payload is
 * derived from the written row via toConvexDoc so the two can't drift; the
 * backfill doubles as the heal path.
 *
 * Migrated TOGETHER because they share the `asset-table.tsx` registry UI — you
 * can't make the table reactive for serialized assets while bulk assets stay on
 * Prisma (and vice versa). See FEATUREDOCS/54.
 *
 * Dual-write (not hard cutover): both carry required+Cascade inbound FKs from
 * tables that stay in Prisma — `asset`: kit_serialized_item / asset_media /
 * maintenance_record_asset / asset_bulk_child; `bulk_asset`: kit_bulk_item /
 * asset_bulk_child / model_bulk_accessory — plus many nullable inbound refs
 * (line items, scan logs, T&T, check/damage records, line-item units).
 * `asset.parentAssetId` is a self-reference (accessories) stored as a plain
 * v.string() in Convex, so backfill needs no ordering. `customFieldValues` is
 * Json (Convex v.any()).
 *
 * The clear-to-null caveat applies (toConvexDoc drops null→absent; the Convex
 * patch validator is v.optional, which rejects null): clearing an asset's
 * supplierId / locationId / kitId / parentAssetId etc. is a no-op in Convex.
 * Same accepted limitation as every other dual-write domain. The hot warehouse
 * paths never clear those to null (they set concrete values), and a backfill run
 * heals any drift. Where a write genuinely clears a FK to null AND that field is
 * shown reactively, mirror an explicit reset instead (see syncAssets* below,
 * which re-reads the row — but those re-reads still drop null→absent).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(row) as any);
}

async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(row);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}

async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id } as any);
}

// ─── Serialized assets ─────────────────────────────────────────────────────────
export const mirrorAssetCreate = (row: Record<string, unknown>) => create(api.assets.createIfMissing, row);
export const patchAssetInConvex = (id: string, row: Record<string, unknown>) => patch(api.assets.update, id, row);
export const removeAssetFromConvex = (id: string) => remove(api.assets.remove, id);

// ─── Bulk assets ─────────────────────────────────────────────────────────────
export const mirrorBulkAssetCreate = (row: Record<string, unknown>) => create(api.bulkAssets.createIfMissing, row);
export const patchBulkAssetInConvex = (id: string, row: Record<string, unknown>) => patch(api.bulkAssets.update, id, row);
export const removeBulkAssetFromConvex = (id: string) => remove(api.bulkAssets.remove, id);

/**
 * Multi-row heal: re-read the given asset ids from Prisma (the fresh mirror) and
 * patch each into Convex. The workhorse for the warehouse / project /
 * maintenance / fault `$transaction`s that mutate `asset.status` / `locationId` /
 * checkout fields across many assets (often via `updateMany`). Call AFTER the
 * transaction commits (Convex is an out-of-transaction HTTP write). Unknown/empty
 * ids are skipped. Strips relations by selecting scalar columns only.
 */
export async function syncAssetsToConvex(assetIds: Array<string | null | undefined>) {
  const unique = [...new Set(assetIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await prisma.asset.findMany({ where: { id: { in: unique } } });
  for (const row of rows) {
    await patchAssetInConvex(row.id, row as unknown as Record<string, unknown>);
  }
}

/** Multi-row heal for bulk assets (quantity / status / location adjustments). */
export async function syncBulkAssetsToConvex(bulkAssetIds: Array<string | null | undefined>) {
  const unique = [...new Set(bulkAssetIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await prisma.bulkAsset.findMany({ where: { id: { in: unique } } });
  for (const row of rows) {
    await patchBulkAssetInConvex(row.id, row as unknown as Record<string, unknown>);
  }
}
