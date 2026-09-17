import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { bumpAssetCounters } from "./counters";

/**
 * Retires ONE asset — isActive:false + status:RETIRED, retiring its linked T&T
 * entries too — inside the caller's transaction. Extracted from
 * `assetWrites.archiveNative` so it's the ONE place "retiring an asset" is defined
 * (R-3.1): `archiveNative` and maintenanceWrites' RETIRE disposition (closing out a
 * completed maintenance record) both call this rather than each hand-rolling the
 * same patch + T&T retire + counter bump. Unconditional, like the code it was
 * extracted from — callers that need an idempotency guard (e.g. skipping an
 * already-RETIRED asset) check the asset's current status themselves, same as the
 * `holdAssets`/`releaseAssets` guards in maintenanceWrites.ts.
 */
export async function retireAssetCore(
  ctx: MutationCtx,
  orgId: string,
  asset: Doc<"assets">,
  now: number,
): Promise<void> {
  const linkedTT = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", asset.id))
    .collect();
  for (const tt of linkedTT) {
    await ctx.db.patch(tt._id, { status: "RETIRED", isActive: false, updatedAt: now });
  }

  await ctx.db.patch(asset._id, { isActive: false, status: "RETIRED", updatedAt: now });
  await bumpAssetCounters(ctx, orgId, asset, { isActive: false, status: "RETIRED" });
}
