import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * `asset_bulk_child` dual-write (Phase 6 decommission groundwork).
 *
 * Bulk children are the "ships with N clamps" accessory join rows on a serialised
 * parent asset. They are created on attach and deleted on detach by the asset
 * accessory server actions (src/server/asset-accessories.ts). This mirror keeps
 * the Convex table "assetBulkChildren" in lockstep so the reactive registry can
 * resolve accessory relationships without a cross-domain Prisma join.
 *
 * Convex calls cannot run inside a Prisma `$transaction`; every caller mirrors
 * AFTER the tx commits, using the row(s) returned from the tx.
 *
 * Always `ConvexError` on the Convex side; `createIfMissing` is idempotent. See
 * FEATUREDOCS/54 and the line-item-unit-mirror sibling.
 */

/** Scalar columns the Convex assetBulkChildren create/update validators accept. */
const SCALAR_KEYS = new Set([
  "id",
  "organizationId",
  "parentAssetId",
  "bulkAssetId",
  "quantity",
  "allocationMode",
  "sortOrder",
  "notes",
  "addedAt",
  "addedById",
]);

function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** Mirror a newly-created bulk child into Convex (idempotent). */
export async function mirrorAssetBulkChildCreate(
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.mutation(api.assetBulkChildren.createIfMissing, doc as any);
}

/** Patch an existing bulk child in Convex (scalar columns only). */
export async function patchAssetBulkChildInConvex(
  id: string,
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row));
  const { id: _id, ...rest } = doc;
  await client.mutation(api.assetBulkChildren.update, {
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch: rest as any,
  });
}

/** Remove a bulk child from Convex (tolerant — remove throws ConvexError if absent). */
export async function removeAssetBulkChildFromConvex(id: string): Promise<void> {
  const client = await getConvexClient();
  await client.mutation(api.assetBulkChildren.remove, { id });
}
