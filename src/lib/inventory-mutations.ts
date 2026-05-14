/**
 * Shared inventory mutation primitives.
 *
 * Why this exists: prior code paths adjusted `BulkAsset.availableQuantity`
 * in several places with subtly different rules. Some checked availability
 * with a separate read-then-write (vulnerable to TOCTOU races on concurrent
 * checkouts), some skipped the check entirely, some bypassed org scoping.
 * Centralizing here makes the invariant a single fact of the codebase:
 *
 *   For every adjustment, BulkAsset.availableQuantity must
 *   never go negative, must stay org-scoped, and must be applied
 *   inside the caller's transaction so it commits/rolls back with
 *   the surrounding operation.
 *
 * All functions in this module require a transaction client. Callers must
 * wrap their work in `prisma.$transaction(async (tx) => { ... })`.
 */

import { Prisma } from "@/generated/prisma/client";

export type TxClient = Prisma.TransactionClient;

export interface BulkAdjustment {
  bulkAssetId: string;
  delta: number; // negative = consume stock, positive = release stock
}

/**
 * Thrown when a bulk adjustment cannot be applied:
 * - bulk asset not found,
 * - cross-org leak,
 * - would push availableQuantity negative under concurrent writes.
 */
export class InventoryError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "CROSS_ORG" | "INSUFFICIENT_STOCK",
    public readonly bulkAssetId?: string,
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

/**
 * Adjusts BulkAsset.availableQuantity atomically under the caller's transaction.
 *
 * Concurrency model: each adjustment uses a guarded `updateMany` whose
 * `where` clause is "id matches AND availableQuantity is high enough to
 * absorb the decrement". If a concurrent writer drained the bulk in the
 * meantime, our updateMany affects zero rows and we throw InventoryError —
 * which rolls back the surrounding transaction. No oversold inventory.
 *
 * Pass adjustments as a list of `{ bulkAssetId, delta }`:
 *   - delta < 0 consumes stock (must be guarded)
 *   - delta > 0 releases stock (no guard needed, always succeeds if the bulk exists in the org)
 *   - delta === 0 is a no-op (skipped)
 *
 * Multiple adjustments against the same bulkAssetId are NOT coalesced — each
 * runs as its own guarded update. Callers should aggregate beforehand if needed.
 */
export async function adjustBulkAvailability(
  tx: TxClient,
  organizationId: string,
  adjustments: BulkAdjustment[],
): Promise<void> {
  for (const { bulkAssetId, delta } of adjustments) {
    if (delta === 0) continue;

    const where: Prisma.BulkAssetWhereInput = {
      id: bulkAssetId,
      organizationId,
      // Guard: when consuming stock, require enough on hand
      ...(delta < 0 ? { availableQuantity: { gte: -delta } } : {}),
    };

    const result = await tx.bulkAsset.updateMany({
      where,
      data: { availableQuantity: { increment: delta } },
    });

    if (result.count === 0) {
      // Diagnose the failure for a useful error message
      const current = await tx.bulkAsset.findUnique({
        where: { id: bulkAssetId },
        select: {
          availableQuantity: true,
          organizationId: true,
          assetTag: true,
        },
      });

      if (!current) {
        throw new InventoryError(
          `Bulk asset ${bulkAssetId} not found`,
          "NOT_FOUND",
          bulkAssetId,
        );
      }
      if (current.organizationId !== organizationId) {
        throw new InventoryError(
          `Bulk asset ${bulkAssetId} belongs to a different organization`,
          "CROSS_ORG",
          bulkAssetId,
        );
      }
      throw new InventoryError(
        `Insufficient stock: ${current.assetTag} has ${current.availableQuantity} available, attempted to consume ${-delta}`,
        "INSUFFICIENT_STOCK",
        bulkAssetId,
      );
    }
  }
}

/**
 * Sums bulk adjustments by bulkAssetId. Useful when a single logical operation
 * (e.g. checking out a kit) touches the same bulk twice via different paths.
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
