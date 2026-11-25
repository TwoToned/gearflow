import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { bumpAssetCounters } from "./counters";
import { diffFields } from "./fieldEditUndo";

/**
 * The status a status WRITER should store: `next`, unless the unit is RETIRED, which no writer
 * overwrites (kit release, return correction, check-in, sale stock). Retire / Reinstate are the
 * only doors; every low-level writer funnels its `status` through this so RETIRED stays one-way.
 */
export function nextStatusUnlessRetired<S extends string>(current: string | null | undefined, next: S): S | "RETIRED" {
  return current === "RETIRED" ? "RETIRED" : next;
}

type RetireFacts ={ status?: string | null; isActive?: boolean | null };

/**
 * Retire and Reinstate are the ONLY paths into and out of RETIRED (each has its gates, its
 * T&T handling and an exact Undo), and `isActive` follows them. The ONE guard compares the STORED
 * doc with the doc an edit RESULTS in (after set, clear and any defaults), so no way of writing
 * the fields (set, clear, omit, a bulk verb) can cross it: status may not cross RETIRED in either
 * direction, and `isActive` may not change at all (absent means active).
 */
export function assertNoRetireBypass(before: RetireFacts, after: RetireFacts): void {
  const statusMoves = (before.status === "RETIRED") !== (after.status === "RETIRED");
  const activeMoves = (before.isActive ?? true) !== (after.isActive ?? true);
  if (statusMoves || activeMoves) {
    throw new ConvexError({ code: "USE_RETIRE", message: "Use Retire or Reinstate to move an asset into or out of retired." });
  }
}

/** A linked T&T row as the retire found it (absent fields are `null`). */
export interface RetiredTestTag {
  id: string;
  status: string | null;
  isActive: boolean | null;
}

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
 *
 * Returns what it changed, so the caller that offers Undo (`archiveNative`) can
 * write it into its own audit row: the asset-field diff (`status`, `isActive`; `null`
 * when nothing changed) and the T&T rows it retired with their prior state. The
 * maintenance RETIRE disposition ignores it.
 */
export async function retireAssetCore(
  ctx: MutationCtx,
  orgId: string,
  asset: Doc<"assets">,
  now: number,
): Promise<{ diff: ReturnType<typeof diffFields>; testTags: RetiredTestTag[] }> {
  const linkedTT = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", asset.id))
    .collect();
  const testTags: RetiredTestTag[] = [];
  for (const tt of linkedTT) {
    if (tt.status === "RETIRED" && tt.isActive === false) continue; // already as a retire leaves it
    testTags.push({ id: tt.id, status: tt.status ?? null, isActive: tt.isActive ?? null });
    await ctx.db.patch(tt._id, { status: "RETIRED", isActive: false, updatedAt: now });
  }

  const set = { isActive: false, status: "RETIRED" as const };
  const diff = diffFields(asset, { ...asset, ...set }, ["status", "isActive"]);
  await ctx.db.patch(asset._id, { ...set, updatedAt: now });
  await bumpAssetCounters(ctx, orgId, asset, set);
  return { diff, testTags };
}
