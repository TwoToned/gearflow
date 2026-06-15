import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * `check_record` dual-write (Phase 6 decommission groundwork).
 *
 * CheckRecord is the immutable audit row written by the check/prep/return flows
 * (one per check-item evaluation against an asset / unit / line item / kit). This
 * mirror keeps the Convex table "checkRecords" in lockstep so the reactive
 * registry can resolve check history without a cross-domain Prisma join.
 *
 * Convex calls cannot run inside a Prisma `$transaction`; every caller mirrors
 * AFTER the tx commits, using the row(s)/id(s) captured from the tx.
 *
 * Always `ConvexError` on the Convex side; `createIfMissing` is idempotent. See
 * FEATUREDOCS/54 and the line-item-unit-mirror / asset-bulk-child-mirror siblings.
 */

/** Scalar columns the Convex checkRecords create/update validators accept. */
const SCALAR_KEYS = new Set([
  "id",
  "organizationId",
  "context",
  "lineItemId",
  "lineItemUnitId",
  "assetId",
  "bulkAssetId",
  "kitId",
  "checkItemId",
  "checkItemLabelSnapshot",
  "checkItemTypeSnapshot",
  "result",
  "value",
  "notes",
  "photos",
  "performedById",
  "performedAt",
]);

function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** Mirror a newly-created check record into Convex (idempotent). */
export async function mirrorCheckRecordCreate(
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.mutation(api.checkRecords.createIfMissing, doc as any);
}

/** Patch an existing check record in Convex (scalar columns only). */
export async function patchCheckRecordInConvex(
  id: string,
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row));
  const { id: _id, ...rest } = doc;
  await client.mutation(api.checkRecords.update, {
    id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch: rest as any,
  });
}

/** Remove a check record from Convex (tolerant — remove throws ConvexError if absent). */
export async function removeCheckRecordFromConvex(id: string): Promise<void> {
  const client = await getConvexClient();
  await client.mutation(api.checkRecords.remove, { id });
}
