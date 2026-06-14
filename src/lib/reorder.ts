/**
 * Reorder candidate logic (Wave 3).
 *
 * Closes the supply-chain loop. Stocktake reveals you're short, damage
 * destroys some bulk items, projects consume stock — all of that needs to
 * trigger a reorder. We already have `BulkAsset.reorderThreshold` and the
 * `SupplierOrder` model. This module pulls them together.
 *
 * Lives outside `"use server"` so integration tests can drive the queries
 * directly with a known orgId.
 */

import { prisma } from "@/lib/prisma";
import { createId } from "@paralleldrive/cuid2";
import { syncBulkAssetsToConvex } from "@/lib/asset-mirror";
import { syncSupplierOrderToConvex } from "@/lib/sub-hire-mirror";
import { getSupplierById, getSupplierMap } from "@/lib/suppliers-read";
import { getModelMap, getModelWithCategoryMap } from "@/lib/models-read";
import { getLocationMap } from "@/lib/locations-read";

export interface ReorderCandidate {
  bulkAssetId: string;
  assetTag: string;
  modelId: string;
  modelName: string;
  categoryName: string | null;
  totalQuantity: number;
  availableQuantity: number;
  reorderThreshold: number;
  /** How much we need to reorder to get back ABOVE the threshold by 50%.
   * Default heuristic: order enough for threshold × 1.5 − available.
   * Operator can edit on the draft. Never returns less than 1. */
  suggestedOrderQuantity: number;
  preferredSupplier: { id: string; name: string } | null;
  /** Per-unit purchase price if recorded — used to seed the draft order. */
  purchasePricePerUnit: number | null;
  lastReorderedAt: Date | null;
  locationName: string | null;
}

/** Every bulk asset at or below its threshold. Grouped by supplier on the
 *  page, but returned flat here for the test to assert against. */
export async function getReorderCandidatesCore(
  organizationId: string,
): Promise<ReorderCandidate[]> {
  // model (+ nested category), preferredSupplier, and location all live in
  // Convex — attached from the maps below, not Prisma joins.
  const rows = await prisma.bulkAsset.findMany({
    where: {
      organizationId,
      isActive: true,
      reorderThreshold: { not: null, gt: 0 },
    },
    orderBy: { availableQuantity: "asc" },
  });

  const candidates = rows.filter(
    (b) =>
      b.reorderThreshold != null &&
      b.availableQuantity <= b.reorderThreshold,
  );

  const [modelMap, supplierMap, locationMap] = await Promise.all([
    getModelWithCategoryMap(organizationId),
    getSupplierMap(organizationId),
    getLocationMap(organizationId),
  ]);

  return candidates.map((b) => {
    const threshold = b.reorderThreshold!;
    const model = modelMap.get(b.modelId);
    const supplier = b.preferredSupplierId ? supplierMap.get(b.preferredSupplierId) : null;
    // Target stock = threshold × 1.5 (rounded up). Order the gap.
    const target = Math.ceil(threshold * 1.5);
    const suggested = Math.max(1, target - b.availableQuantity);
    return {
      bulkAssetId: b.id,
      assetTag: b.assetTag,
      modelId: b.modelId,
      modelName: model?.name ?? "",
      categoryName: model?.category?.name ?? null,
      totalQuantity: b.totalQuantity,
      availableQuantity: b.availableQuantity,
      reorderThreshold: threshold,
      suggestedOrderQuantity: suggested,
      preferredSupplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      purchasePricePerUnit: b.purchasePricePerUnit != null
        ? Number(b.purchasePricePerUnit)
        : null,
      lastReorderedAt: b.lastReorderedAt,
      locationName: (b.locationId ? locationMap.get(b.locationId)?.name : null) ?? null,
    };
  });
}

export interface ReorderDraftLine {
  bulkAssetId: string;
  quantity: number;
  unitPrice?: number;
}

/** Create a DRAFT SupplierOrder + items for a list of bulk-asset rows.
 *  Lives in core so tests can drive it without faking request headers. */
export async function createReorderDraftCore(
  input: {
    organizationId: string;
    userId: string;
    supplierId: string;
    lines: ReorderDraftLine[];
    notes?: string;
  },
): Promise<{ id: string; orderNumber: string; lineCount: number }> {
  const { organizationId, userId, supplierId, lines, notes } = input;

  if (lines.length === 0) {
    throw new Error("At least one line item is required");
  }

  // Verify supplier belongs to org (suppliers live in Convex now).
  const supplier = await getSupplierById(supplierId);
  if (!supplier || supplier.organizationId !== organizationId) {
    throw new Error("Supplier not found");
  }

  // Verify every bulk asset belongs to org. Fetch in one query to
  // avoid N+1 + cross-org leak.
  const bulks = await prisma.bulkAsset.findMany({
    where: {
      id: { in: lines.map((l) => l.bulkAssetId) },
      organizationId,
    },
  });
  if (bulks.length !== lines.length) {
    throw new Error("One or more items could not be found in this organization");
  }
  // model name (for the order-line description) lives in Convex — resolve from
  // the map, not a Prisma join.
  const modelMap = await getModelMap(organizationId);

  // Order number: REORDER-{YYYYMMDD}-{short id}. cuid2 (8 chars) instead of
  // Math.random's 4 base-36 chars — the latter has only ~1.7M values per
  // day, so two concurrent drafts on a busy day could collide. orderNumber
  // has no DB unique constraint, so a collision would silently double up.
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const orderNumber = `REORDER-${datePart}-${createId().slice(0, 8).toUpperCase()}`;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.supplierOrder.create({
      data: {
        organizationId,
        supplierId,
        orderNumber,
        type: "PURCHASE",
        status: "DRAFT",
        notes: notes ?? `Reorder draft generated from low-stock dashboard (${lines.length} line${lines.length === 1 ? "" : "s"})`,
        createdById: userId,
        items: {
          create: lines.map((l, idx) => {
            const bulk = bulks.find((b) => b.id === l.bulkAssetId)!;
            const unitPrice = l.unitPrice;
            const quantity = l.quantity;
            const lineTotal = unitPrice != null ? unitPrice * quantity : null;
            return {
              description: `${modelMap.get(bulk.modelId)?.name ?? "Item"} — restock (${bulk.assetTag})`,
              modelId: bulk.modelId,
              quantity,
              unitPrice: unitPrice ?? undefined,
              lineTotal: lineTotal ?? undefined,
              sortOrder: idx,
            };
          }),
        },
      },
      include: { items: true },
    });

    // Stamp lastReorderedAt on each bulk asset so the dashboard can show
    // "ordered N days ago" without scanning order history.
    await tx.bulkAsset.updateMany({
      where: { id: { in: lines.map((l) => l.bulkAssetId) }, organizationId },
      data: { lastReorderedAt: now },
    });

    return { id: order.id, orderNumber: order.orderNumber, lineCount: order.items.length };
  });

  // Mirror the lastReorderedAt stamp on each bulk asset + the draft supplier
  // order (head + items) to Convex.
  await syncBulkAssetsToConvex(lines.map((l) => l.bulkAssetId));
  await syncSupplierOrderToConvex(result.id);

  return result;
}
