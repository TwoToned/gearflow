import { createId } from "@paralleldrive/cuid2";
import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the `maintenanceRecordAsset` join (Phase B write
 * inversion, bucket-2). The join is CONVEX-ONLY now: the maintenance write paths
 * (create/update link/unlink) and the predictive-maintenance auto-create write the
 * Convex `maintenanceRecordAssets` doc as the sole source of truth (no Prisma row,
 * no mirror). No inbound Prisma FK on the join itself drives anything we keep — the
 * Cascade from maintenanceRecord is re-implemented as an explicit Convex delete in
 * the maintenance delete path. The Prisma `maintenance_record_asset` table is left
 * unwritten until Phase C drops it.
 *
 * These helpers read the Convex copy as flat `{ id, maintenanceRecordId, assetId }`
 * rows. The asset/model + Auth-User joins the maintenance reads attach stay
 * separate (asset scalars come from Convex `assets`, model from Convex, users from
 * Prisma). See FEATUREDOCS/54.
 */

type RawLink = Doc<"maintenanceRecordAssets">;

export interface MaintenanceRecordAssetRow {
  id: string;
  maintenanceRecordId: string;
  assetId: string;
}

export function mapLink(d: RawLink): MaintenanceRecordAssetRow {
  return {
    id: d.id,
    maintenanceRecordId: d.maintenanceRecordId,
    assetId: d.assetId,
  };
}

/**
 * Join rows for many maintenance records in one round trip — the
 * `findMany({ where: { maintenanceRecordId: { in } } })` the maintenance reads
 * (`attachJoins`, `getRecentActivity`) used. Org scope is enforced by the caller
 * (it only passes record ids it already org-checked).
 */
export async function getMaintenanceAssetLinksByRecordIds(
  maintenanceRecordIds: string[],
): Promise<MaintenanceRecordAssetRow[]> {
  if (maintenanceRecordIds.length === 0) return [];
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(
      api.maintenanceRecordAssets.listByMaintenanceRecordIds,
      { maintenanceRecordIds },
    ),
  )) as RawLink[];
  return rows.map(mapLink);
}

/**
 * Join rows for many assets in one round trip — the asset-side of the
 * `releaseAssets` "is any OTHER active record still holding this asset?" check.
 * Returns flat links; the caller re-applies the record-status filter (holding +
 * exclude the current record) in JS against the Convex maintenance records.
 */
export async function getMaintenanceAssetLinksByAssetIds(
  assetIds: string[],
): Promise<MaintenanceRecordAssetRow[]> {
  if (assetIds.length === 0) return [];
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.maintenanceRecordAssets.listByAssetIds, {
      assetIds,
    }),
  )) as RawLink[];
  return rows.map(mapLink);
}

// ─── Convex-only writes (Phase B) ────────────────────────────────────────────

/**
 * Create the asset links for a maintenance record (Convex-only). Re-implements
 * the old Prisma nested `assets.create` AND the `@@unique([maintenanceRecordId,
 * assetId])` constraint: existing links for the record are read first and
 * duplicates skipped, so a re-issued create is idempotent. Each link gets a fresh
 * cuid (the old join `id @default(cuid())`).
 */
export async function createMaintenanceAssetLinks(
  maintenanceRecordId: string,
  assetIds: string[],
  organizationId: string,
): Promise<void> {
  if (assetIds.length === 0) return;
  const convex = await getConvexClient();
  const existing = await getMaintenanceAssetLinksByRecordIds([maintenanceRecordId]);
  const have = new Set(existing.map((l) => l.assetId));
  const toCreate = Array.from(new Set(assetIds)).filter((aId) => !have.has(aId));
  if (toCreate.length === 0) return;
  // ONE array mutation (bulk single-call), org-verified per parent record.
  await convex.mutation(api.maintenanceRecordAssets.createManyIfMissing, {
    organizationId,
    links: toCreate.map((assetId) => ({
      id: createId(),
      maintenanceRecordId,
      assetId,
    })),
  });
}

/**
 * Remove the links for a record that point at any of `assetIds` (Convex-only) —
 * the old Prisma nested `assets.deleteMany({ assetId: { in } })`.
 */
export async function removeMaintenanceAssetLinks(
  maintenanceRecordId: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) return;
  const convex = await getConvexClient();
  const links = await getMaintenanceAssetLinksByRecordIds([maintenanceRecordId]);
  const drop = new Set(assetIds);
  for (const l of links) {
    if (drop.has(l.assetId)) {
      await convex.mutation(api.maintenanceRecordAssets.remove, { id: l.id });
    }
  }
}

/**
 * Delete ALL links for a record (Convex-only) — re-implements the
 * `onDelete: Cascade` from maintenanceRecord → maintenanceRecordAsset when a
 * maintenance record is deleted.
 */
export async function removeAllMaintenanceAssetLinks(
  maintenanceRecordId: string,
): Promise<void> {
  const convex = await getConvexClient();
  const links = await getMaintenanceAssetLinksByRecordIds([maintenanceRecordId]);
  for (const l of links) {
    await convex.mutation(api.maintenanceRecordAssets.remove, { id: l.id });
  }
}
