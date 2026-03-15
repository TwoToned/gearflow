import { prisma } from "@/lib/prisma";

export interface OverbookedInfo {
  /** How many units over capacity */
  overBy: number;
  /** Total active assets for this model */
  totalStock: number;
  /** Usable stock (totalStock minus unavailable assets) */
  effectiveStock: number;
  /** Total booked across all overlapping projects */
  totalBooked: number;
  /** True when a kit parent is overbooked only because its children are */
  inherited?: boolean;
  /** Number of assets in non-usable statuses (IN_MAINTENANCE, LOST, etc.) */
  unavailableAssets?: number;
  /** True when overbooking is ONLY caused by unavailable assets, not other bookings */
  reducedOnly?: boolean;
  /** Kit parent: has children that are truly overbooked (booking conflicts) */
  hasOverbookedChildren?: boolean;
  /** Kit parent: has children with reduced stock (unavailable assets) */
  hasReducedChildren?: boolean;
}

/**
 * Computes which line items on a project are overbooked.
 * Returns a Map of line item ID → overbooking details.
 * Batches all DB queries for efficiency.
 *
 * Kit children count toward model availability — if a kit contains 3 mics
 * and 2 more are added individually, all 5 count against the model's stock.
 *
 * Assets in IN_MAINTENANCE, LOST, or RETIRED status reduce effective stock.
 */
export async function computeOverbookedStatus(
  organizationId: string,
  lineItems: Array<{
    id: string;
    modelId: string | null;
    quantity: number;
    isKitChild: boolean;
    parentLineItemId: string | null;
    kitId: string | null;
    status: string;
  }>,
  rentalStartDate: Date | null,
  rentalEndDate: Date | null,
  projectId: string,
): Promise<Map<string, OverbookedInfo>> {
  const overbookedMap = new Map<string, OverbookedInfo>();

  if (!rentalStartDate || !rentalEndDate) return overbookedMap;

  // Collect ALL equipment line items with a modelId (including kit children)
  const relevantItems = lineItems.filter(
    (li) => li.modelId && li.status !== "CANCELLED",
  );
  if (relevantItems.length === 0) return overbookedMap;

  const modelIds = [...new Set(relevantItems.map((li) => li.modelId!))];

  // Batch query: all overlapping bookings for these models across all projects
  // Include BOTH regular items AND kit children — they all consume stock
  const overlappingBookings = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      modelId: { in: modelIds },
      status: { not: "CANCELLED" },
      project: {
        isTemplate: false,
        status: {
          notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"],
        },
        rentalStartDate: { lte: rentalEndDate },
        rentalEndDate: { gte: rentalStartDate },
      },
    },
    select: { modelId: true, quantity: true, projectId: true },
  });

  // Sum booked per model (total across all projects)
  const totalBookedByModel = new Map<string, number>();
  const thisProjectBookedByModel = new Map<string, number>();
  for (const booking of overlappingBookings) {
    const mid = booking.modelId!;
    totalBookedByModel.set(mid, (totalBookedByModel.get(mid) || 0) + booking.quantity);
    if (booking.projectId === projectId) {
      thisProjectBookedByModel.set(mid, (thisProjectBookedByModel.get(mid) || 0) + booking.quantity);
    }
  }

  // Batch query: total stock per model (including asset status breakdown for serialized)
  const models = await prisma.model.findMany({
    where: { id: { in: modelIds }, organizationId },
    include: {
      assets: { where: { isActive: true }, select: { id: true, status: true } },
      bulkAssets: { where: { isActive: true }, select: { totalQuantity: true } },
    },
  });

  const stockByModel = new Map<string, number>();
  const effectiveStockByModel = new Map<string, number>();
  const unavailableByModel = new Map<string, number>();

  for (const model of models) {
    if (model.assetType === "SERIALIZED") {
      const total = model.assets.length;
      const unavailable = model.assets.filter(
        (a) => a.status === "IN_MAINTENANCE" || a.status === "LOST" || a.status === "RETIRED"
      ).length;
      stockByModel.set(model.id, total);
      effectiveStockByModel.set(model.id, total - unavailable);
      unavailableByModel.set(model.id, unavailable);
    } else {
      const total = model.bulkAssets.reduce((sum, ba) => sum + ba.totalQuantity, 0);
      stockByModel.set(model.id, total);
      effectiveStockByModel.set(model.id, total);
      unavailableByModel.set(model.id, 0);
    }
  }

  // For each model, check if this project's total booking exceeds available
  for (const modelId of modelIds) {
    const totalStock = stockByModel.get(modelId) || 0;
    const effectiveStock = effectiveStockByModel.get(modelId) || 0;
    const unavailable = unavailableByModel.get(modelId) || 0;
    const totalBooked = totalBookedByModel.get(modelId) || 0;
    const bookedByOthers = totalBooked - (thisProjectBookedByModel.get(modelId) || 0);
    const bookedByThisProject = thisProjectBookedByModel.get(modelId) || 0;

    // Check against effective stock (factors in unavailable assets)
    const availableForProject = effectiveStock - bookedByOthers;

    if (bookedByThisProject > availableForProject) {
      const overBy = bookedByThisProject - availableForProject;
      // Would it be overbooked if all assets were available?
      const wouldBeOverWithFullStock = bookedByThisProject > (totalStock - bookedByOthers);
      const reducedOnly = !wouldBeOverWithFullStock && unavailable > 0;

      const info: OverbookedInfo = {
        overBy,
        totalStock,
        effectiveStock,
        totalBooked,
        unavailableAssets: unavailable > 0 ? unavailable : undefined,
        reducedOnly,
      };
      // Mark all line items of this model on this project as overbooked
      for (const li of relevantItems) {
        if (li.modelId === modelId) {
          overbookedMap.set(li.id, info);
        }
      }
    }
  }

  // Also mark kit parent items as overbooked if any of their children are
  for (const li of lineItems) {
    if (li.kitId && !li.isKitChild) {
      const children = lineItems.filter((c) => c.parentLineItemId === li.id);
      const overbookedChildren = children.filter((c) => overbookedMap.has(c.id));
      if (overbookedChildren.length > 0) {
        // Aggregate: sum up the overBy from distinct models
        const seen = new Set<string>();
        let totalOver = 0;
        let totalStock = 0;
        let effectiveStock = 0;
        let totalBooked = 0;
        let anyReduced = false;
        let allReduced = true;
        let totalUnavailable = 0;
        for (const c of overbookedChildren) {
          const info = overbookedMap.get(c.id)!;
          const mid = c.modelId!;
          if (!seen.has(mid)) {
            seen.add(mid);
            totalOver += info.overBy;
            totalStock += info.totalStock;
            effectiveStock += info.effectiveStock;
            totalBooked += info.totalBooked;
            totalUnavailable += info.unavailableAssets || 0;
            if (info.reducedOnly) anyReduced = true;
            else allReduced = false;
          }
        }
        if (seen.size > 0 && !anyReduced) allReduced = false;
        const anyOverbooked = !allReduced; // at least one child is truly overbooked
        overbookedMap.set(li.id, {
          overBy: totalOver,
          totalStock,
          effectiveStock,
          totalBooked,
          inherited: true,
          unavailableAssets: totalUnavailable > 0 ? totalUnavailable : undefined,
          reducedOnly: allReduced && anyReduced,
          hasOverbookedChildren: anyOverbooked,
          hasReducedChildren: anyReduced,
        });
      }
    }
  }

  return overbookedMap;
}
