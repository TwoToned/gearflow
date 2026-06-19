import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * Shared inventory mutation primitive — Convex port of
 * `src/lib/inventory-mutations.ts` `adjustBulkAvailability`.
 *
 * Invariant: `bulkAsset.availableQuantity` must never go negative, must stay
 * org-scoped, and the whole adjustment commits/rolls back with the surrounding
 * mutation. In Prisma this needed a guarded `updateMany` to dodge TOCTOU; in a
 * Convex mutation a plain read-check-write is already race-free (the mutation is
 * serializable; OCC retries the loser of a write-write race), so the guard is
 * just an `if`. Throwing `ConvexError` rolls back the entire mutation — this is
 * what makes kit checkout all-or-nothing (a short bulk aborts the whole deploy).
 */

export interface BulkAdjustment {
  bulkAssetId: string;
  /** negative = consume stock, positive = release stock */
  delta: number;
}

/**
 * Apply a list of `{ bulkAssetId, delta }` adjustments inside the caller's
 * mutation. `delta < 0` consumes (guarded against going negative), `delta > 0`
 * releases (always succeeds if the bulk exists in the org), `delta === 0` is a
 * no-op. Adjustments are NOT coalesced — aggregate with `coalesceAdjustments`
 * first if the same bulk is touched twice.
 */
export async function adjustBulkAvailability(
  ctx: MutationCtx,
  organizationId: string,
  adjustments: BulkAdjustment[],
): Promise<void> {
  for (const { bulkAssetId, delta } of adjustments) {
    if (delta === 0) continue;

    const doc = await ctx.db
      .query("bulkAssets")
      .withIndex("by_cuid", (q) => q.eq("id", bulkAssetId))
      .unique();

    if (!doc) {
      throw new ConvexError(`Bulk asset ${bulkAssetId} not found`);
    }
    if (doc.organizationId !== organizationId) {
      throw new ConvexError(
        `Bulk asset ${bulkAssetId} belongs to a different organization`,
      );
    }
    const current = doc.availableQuantity ?? 0;
    const next = current + delta;
    if (next < 0) {
      throw new ConvexError(
        `Insufficient stock: ${doc.assetTag} has ${current} available, attempted to consume ${-delta}`,
      );
    }
    await ctx.db.patch(doc._id, { availableQuantity: next });
  }
}

/**
 * Sum bulk adjustments by bulkAssetId (e.g. a kit that touches the same bulk via
 * two paths). Pure — mirrors `inventory-mutations.ts coalesceAdjustments`.
 */
export function coalesceAdjustments(
  adjustments: BulkAdjustment[],
): BulkAdjustment[] {
  const byId = new Map<string, number>();
  for (const a of adjustments) {
    byId.set(a.bulkAssetId, (byId.get(a.bulkAssetId) ?? 0) + a.delta);
  }
  return Array.from(byId, ([bulkAssetId, delta]) => ({ bulkAssetId, delta }));
}
