import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * `asset_scan_log` dual-write (Phase 6 decommission groundwork).
 *
 * assetScanLog is an APPEND-ONLY event table — one row per scan (check-in /
 * check-out / move / etc.). Rows are created on scans and essentially never
 * updated or deleted, so the mirror is trivial: mirror each create. There is no
 * reconcile and no patch path; `removeAssetScanLogFromConvex` exists only for
 * completeness (e.g. an org wipe).
 *
 * Convex calls cannot run inside a Prisma `$transaction`; every caller captures
 * the created row(s) from the tx and mirrors AFTER the tx commits.
 *
 * Always `ConvexError` on the Convex side; `createIfMissing` is idempotent. See
 * FEATUREDOCS/54 and the asset-bulk-child-mirror / line-item-unit-mirror siblings.
 */

/** Scalar columns the Convex assetScanLogs create validator accepts. */
const SCALAR_KEYS = new Set([
  "id",
  "organizationId",
  "assetId",
  "bulkAssetId",
  "kitId",
  "projectId",
  "action",
  "scannedById",
  "scannedAt",
  "notes",
  "location",
]);

function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** Mirror a newly-created asset scan log into Convex (idempotent). */
export async function mirrorAssetScanLogCreate(
  row: Record<string, unknown>,
): Promise<void> {
  const client = await getConvexClient();
  const doc = strip(toConvexDoc(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.mutation(api.assetScanLogs.createIfMissing, doc as any);
}

/** Remove an asset scan log from Convex (tolerant — remove throws ConvexError if absent). */
export async function removeAssetScanLogFromConvex(id: string): Promise<void> {
  const client = await getConvexClient();
  await client.mutation(api.assetScanLogs.remove, { id });
}
