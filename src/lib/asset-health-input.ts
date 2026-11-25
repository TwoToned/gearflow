import type { AssetHealthInput } from "../../convex/lib/assetHealth";
import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";

/**
 * Maps the asset page's data onto `assetHealth()`'s input. Pure: the bundle's server-side
 * facts (service, checks, repairs, due back) plus the one client-read fact (double
 * bookings, `null` until the bookings read lands, so it reads `not checked`, never clear).
 */
export function buildHealthInput(asset: NativeAssetDetail, now: number, doubleBookings: number | null): AssetHealthInput {
  const tt = asset.testTagAsset;
  const f = asset.facts;
  return {
    now,
    status: asset.status,
    condition: asset.condition,
    requiresTestAndTag: asset.model?.requiresTestAndTag ?? false,
    // A retired / inactive registration is passed through and judged by `assetHealth` itself.
    testTag: tt
      ? {
          status: tt.isActive === false ? "RETIRED" : tt.status,
          lastTestDate: tt.lastTestDate ? tt.lastTestDate.getTime() : null,
          nextDueDate: tt.nextDueDate ? tt.nextDueDate.getTime() : null,
        }
      : null,
    service: { schedules: f.serviceSchedules, lastServiceAt: f.lastServiceAt },
    checks: { lastResult: f.lastCheckResult, hasPrepOrReturn: f.hasPrepOrReturnCheck },
    dueBackAt: f.dueBackAt,
    doubleBookings,
    openRepairs: f.openRepairs,
  };
}
