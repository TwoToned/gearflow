/**
 * Shared transaction-level helpers for the line-item fulfillment model.
 *
 * The order line (`ProjectLineItem`) keeps its quantity and its denormalised
 * rollup fields; the truth for each physical unit lives in
 * `ProjectLineItemUnit`. Checkout / check-in / prep / kit flows all mutate
 * unit rows and then call `syncLineItemRollup` so the order line never
 * drifts from its units.
 *
 * See docs/designs/line-item-fulfillment-model.md.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  computeRollupCounters,
  deriveOrderLineStatus,
  deriveOrderLinePrepStatus,
  nextOrdinal,
} from "@/lib/line-item-units";

/** Columns the rollup needs off each unit row. */
const UNIT_ROLLUP_SELECT = {
  quantity: true,
  returnedQuantity: true,
  status: true,
  prepStatus: true,
  returnCondition: true,
  returnStatus: true,
} as const;

/**
 * Recompute a line item's rollup counters and derived display status from
 * its unit rows, and persist them. MUST be called inside the same
 * transaction as the unit write that triggered it.
 */
export async function syncLineItemRollup(
  tx: Prisma.TransactionClient,
  lineItemId: string,
): Promise<void> {
  const line = await tx.projectLineItem.findUnique({
    where: { id: lineItemId },
    select: { status: true, prepStatus: true },
  });
  if (!line) return;

  const units = await tx.projectLineItemUnit.findMany({
    where: { lineItemId },
    select: UNIT_ROLLUP_SELECT,
  });

  await tx.projectLineItem.update({
    where: { id: lineItemId },
    data: {
      ...computeRollupCounters(units),
      status: deriveOrderLineStatus(line.status, units),
      // The warehouse UI routes prep ↔ deploy on line.prepStatus.
      // Without this, a packed unit never moves the line off PULLED.
      prepStatus: deriveOrderLinePrepStatus(line.prepStatus, units),
    },
  });
}

/**
 * Find the existing unit for a (lineItem, asset) pair, or create one.
 * Serialised assets are one unit per asset (`quantity` 1); the
 * `[lineItemId, assetId]` unique index makes this idempotent under
 * concurrent scans.
 */
export async function ensureSerialisedUnit(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    lineItemId: string;
    assetId: string;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.projectLineItemUnit.findUnique({
    where: {
      lineItemId_assetId: {
        lineItemId: args.lineItemId,
        assetId: args.assetId,
      },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const siblings = await tx.projectLineItemUnit.findMany({
    where: { lineItemId: args.lineItemId },
    select: { ordinal: true },
  });
  const unit = await tx.projectLineItemUnit.create({
    data: {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      ordinal: nextOrdinal(siblings),
      assetId: args.assetId,
      quantity: 1,
      status: "CONFIRMED",
    },
    select: { id: true },
  });
  return { id: unit.id, created: true };
}

/**
 * Find the bulk unit row for a line, or create it. A bulk line has a single
 * unit row carrying the quantity (bulk assets are a stock pool, not
 * individually identifiable units).
 */
export async function ensureBulkUnit(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    lineItemId: string;
    bulkAssetId: string;
    quantity: number;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.projectLineItemUnit.findFirst({
    where: { lineItemId: args.lineItemId, bulkAssetId: args.bulkAssetId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const unit = await tx.projectLineItemUnit.create({
    data: {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      ordinal: 1,
      bulkAssetId: args.bulkAssetId,
      quantity: args.quantity,
      status: "CONFIRMED",
    },
    select: { id: true },
  });
  return { id: unit.id, created: true };
}

/**
 * Map a return condition to the canonical asset status to set on
 * checkin. Centralised so checkInItems, completeCheckAndStore, and
 * any future caller stay in sync.
 */
export function assetStatusFromReturnCondition(
  cond: "GOOD" | "DAMAGED" | "MISSING",
): "AVAILABLE" | "IN_MAINTENANCE" | "LOST" {
  if (cond === "DAMAGED") return "IN_MAINTENANCE";
  if (cond === "MISSING") return "LOST";
  return "AVAILABLE";
}

/**
 * Return one or many units on a line. THE single source of truth for
 * what "returning" means physically: flip the matching unit row(s) to
 * RETURNED, restore the asset(s), update location.
 *
 * Three modes:
 *   - `assetId` given → return exactly that asset's unit (scan flow).
 *   - `bulkAssetId` given → accumulate quantity onto the bulk unit row.
 *   - Neither → "return whole line": find every still-out unit and
 *     flip each. Falls back to flipping the order line directly if no
 *     units exist (kit children + legacy lines).
 *
 * Caller is responsible for the `requirePermission` check and the
 * surrounding $transaction. This function MUST run inside one. Caller
 * also handles syncLineItemRollup at the end (so multiple returns on
 * the same line in one outer call only re-roll once).
 *
 * Returns the count of unit rows that were actually flipped (useful
 * for scan-log notes; the caller can decide whether to write a log).
 */
export async function returnLineUnits(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    projectId: string;
    lineItemId: string;
    /** Specific asset being returned via a scan. */
    assetId?: string | null;
    /** Bulk asset for legacy bulk lines (line.bulkAssetId). */
    bulkAssetId?: string | null;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    quantity?: number;
    notes?: string | null;
    /** User performing the return — stamped on unit + asset scan log. */
    userId: string;
    /** Where the asset goes back to. */
    defaultLocationId: string | null;
  },
): Promise<{ unitsFlipped: number; assetsTouched: string[] }> {
  const assetStatus = assetStatusFromReturnCondition(args.returnCondition);
  const lineItem = await tx.projectLineItem.findFirstOrThrow({
    where: {
      id: args.lineItemId,
      projectId: args.projectId,
      organizationId: args.organizationId,
    },
  });

  // ── 1. Specific asset (scan) ────────────────────────────────────
  const targetAssetId = args.assetId || lineItem.assetId || null;
  if (targetAssetId) {
    const unit = await tx.projectLineItemUnit.findUnique({
      where: {
        lineItemId_assetId: {
          lineItemId: lineItem.id,
          assetId: targetAssetId,
        },
      },
      select: { id: true, status: true },
    });
    if (!unit) {
      // Kit child / legacy line — no unit; flip the line + asset directly.
      await tx.projectLineItem.update({
        where: { id: lineItem.id },
        data: {
          status: "RETURNED",
          returnedQuantity: lineItem.quantity,
          returnedAt: new Date(),
          returnedBy: { connect: { id: args.userId } },
          returnCondition: args.returnCondition,
          returnNotes: args.notes || null,
        },
      });
      await tx.asset.update({
        where: { id: targetAssetId },
        data: { status: assetStatus, locationId: args.defaultLocationId },
      });
      return { unitsFlipped: 0, assetsTouched: [targetAssetId] };
    }
    // Guarded transition.
    const flipped = await tx.projectLineItemUnit.updateMany({
      where: { id: unit.id, status: "CHECKED_OUT" },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        returnedById: args.userId,
        returnCondition: args.returnCondition,
        returnNotes: args.notes || null,
      },
    });
    if (flipped.count > 0) {
      await tx.asset.update({
        where: { id: targetAssetId },
        data: { status: assetStatus, locationId: args.defaultLocationId },
      });
    }
    return { unitsFlipped: flipped.count, assetsTouched: [targetAssetId] };
  }

  // ── 2. Bulk line return ────────────────────────────────────────
  const targetBulkId = args.bulkAssetId || lineItem.bulkAssetId || null;
  if (targetBulkId) {
    const returnQty = args.quantity || 1;
    const unit = await tx.projectLineItemUnit.findFirst({
      where: { lineItemId: lineItem.id, bulkAssetId: targetBulkId },
    });
    if (unit) {
      const newReturned = Math.min(
        unit.quantity,
        unit.returnedQuantity + returnQty,
      );
      const fullyReturned = newReturned >= unit.quantity;
      await tx.projectLineItemUnit.update({
        where: { id: unit.id },
        data: {
          returnedQuantity: newReturned,
          status: fullyReturned ? "RETURNED" : "CHECKED_OUT",
          returnedAt: fullyReturned ? new Date() : unit.returnedAt,
          returnedById: fullyReturned ? args.userId : unit.returnedById,
          returnCondition: args.returnCondition,
          returnNotes: args.notes || unit.returnNotes,
        },
      });
    }
    return { unitsFlipped: unit ? 1 : 0, assetsTouched: [] };
  }

  // ── 3. Return-whole-line ───────────────────────────────────────
  // No specific asset and no line-level bulk: find every still-out
  // unit on this line and flip each. If there are none, the line is
  // a kit child / generic — flip the line itself.
  const outUnits = await tx.projectLineItemUnit.findMany({
    where: { lineItemId: lineItem.id, status: "CHECKED_OUT" },
  });
  if (outUnits.length === 0) {
    await tx.projectLineItem.update({
      where: { id: lineItem.id },
      data: {
        status: "RETURNED",
        returnedQuantity: lineItem.checkedOutQuantity || lineItem.quantity,
        returnedAt: new Date(),
        returnedBy: { connect: { id: args.userId } },
        returnCondition: args.returnCondition,
        returnNotes: args.notes || null,
      },
    });
    return { unitsFlipped: 0, assetsTouched: [] };
  }
  const assetsTouched: string[] = [];
  for (const u of outUnits) {
    await tx.projectLineItemUnit.update({
      where: { id: u.id },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        returnedById: args.userId,
        returnCondition: args.returnCondition,
        returnNotes: args.notes || null,
        ...(u.bulkAssetId ? { returnedQuantity: u.quantity } : {}),
      },
    });
    if (u.assetId) {
      await tx.asset.update({
        where: { id: u.assetId },
        data: { status: assetStatus, locationId: args.defaultLocationId },
      });
      assetsTouched.push(u.assetId);
    }
  }
  return { unitsFlipped: outUnits.length, assetsTouched };
}

/**
 * Mark a unit prepped/packed (the pick-and-pack step before checkout).
 * Serialised and bulk lines get a PACKED unit row; a generic line with no
 * asset assigned just carries prepStatus on the order line. Rolls the line
 * up and returns it (with model/asset/bulkAsset included).
 */
/**
 * Expand a specific serialised asset's permanent accessories onto a line as
 * accessory child lines (childKind: ACCESSORY). Idempotent: dedups serialised
 * accessories by their specific assetId and bulk accessories by bulkAssetId, so
 * re-scanning the same parent doesn't duplicate rows.
 *
 * This is what makes accessories travel when the warehouse assigns a specific
 * unit to a model-level line at prep/checkout (not just when the office adds
 * the specific asset to the project). Returns the ids of any child lines created.
 *
 * v1 limitation: for a multi-quantity line where several parents each carry the
 * SAME bulk accessory, the bulk row is created once (dedup by bulkAssetId).
 * Serialised accessories accumulate correctly (unique per physical unit).
 */
export async function expandAccessoriesForAsset(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; lineItemId: string; assetId: string },
): Promise<string[]> {
  const { organizationId, lineItemId, assetId } = args;
  const line = await tx.projectLineItem.findUnique({
    where: { id: lineItemId },
    select: {
      projectId: true,
      categoryId: true,
      groupId: true,
      duration: true,
      pricingType: true,
      childKind: true,
    },
  });
  if (!line || line.childKind) return []; // missing, or itself a child — never nest

  const asset = await tx.asset.findUnique({
    where: { id: assetId },
    select: {
      childAssets: { select: { id: true, modelId: true, model: { select: { name: true } } } },
      childBulkItems: {
        select: { bulkAssetId: true, quantity: true, bulkAsset: { select: { modelId: true, model: { select: { name: true } } } } },
      },
    },
  });
  if (!asset || (asset.childAssets.length === 0 && asset.childBulkItems.length === 0)) return [];

  const existing = await tx.projectLineItem.findMany({
    where: { parentLineItemId: lineItemId, childKind: "ACCESSORY", organizationId },
    select: { assetId: true, bulkAssetId: true },
  });
  const haveAsset = new Set(existing.map((e) => e.assetId).filter(Boolean));
  const haveBulk = new Set(existing.map((e) => e.bulkAssetId).filter(Boolean));

  const created: string[] = [];
  let sort = existing.length;
  for (const child of asset.childAssets) {
    if (haveAsset.has(child.id)) continue;
    const row = await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId: line.projectId,
        type: "EQUIPMENT",
        modelId: child.modelId,
        assetId: child.id,
        quantity: 1,
        isKitChild: true,
        childKind: "ACCESSORY",
        parentLineItemId: lineItemId,
        categoryId: line.categoryId,
        groupId: line.groupId,
        description: child.model?.name ?? null,
        unitPrice: null,
        pricingType: line.pricingType,
        duration: line.duration,
        sortOrder: sort++,
      },
      select: { id: true },
    });
    created.push(row.id);
  }
  for (const bi of asset.childBulkItems) {
    if (haveBulk.has(bi.bulkAssetId)) continue;
    const row = await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId: line.projectId,
        type: "EQUIPMENT",
        modelId: bi.bulkAsset.modelId,
        bulkAssetId: bi.bulkAssetId,
        quantity: bi.quantity,
        isKitChild: true,
        childKind: "ACCESSORY",
        parentLineItemId: lineItemId,
        categoryId: line.categoryId,
        groupId: line.groupId,
        description: bi.bulkAsset.model?.name ? `${bi.quantity}x ${bi.bulkAsset.model.name}` : null,
        unitPrice: null,
        pricingType: line.pricingType,
        duration: line.duration,
        sortOrder: sort++,
      },
      select: { id: true },
    });
    created.push(row.id);
  }
  return created;
}

export async function prepUnit(
  tx: Prisma.TransactionClient,
  args: {
    organizationId: string;
    lineItemId: string;
    assetId?: string | null;
    bulkAssetId?: string | null;
    quantity?: number;
    prepContainer?: string | null;
  },
) {
  if (args.assetId) {
    const { id } = await ensureSerialisedUnit(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      assetId: args.assetId,
    });
    await tx.projectLineItemUnit.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.prepContainer !== undefined
          ? { prepContainer: args.prepContainer }
          : {}),
      },
    });
    // Accessories of this specific asset join the line so they show on the
    // pull sheet and get packed/deployed with it.
    await expandAccessoriesForAsset(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      assetId: args.assetId,
    });
  } else if (args.bulkAssetId) {
    const { id } = await ensureBulkUnit(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      bulkAssetId: args.bulkAssetId,
      quantity: args.quantity ?? 1,
    });
    await tx.projectLineItemUnit.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
        ...(args.prepContainer !== undefined
          ? { prepContainer: args.prepContainer }
          : {}),
      },
    });
  } else {
    // Generic line, no serial scanned — mark prep state on the line itself.
    await tx.projectLineItem.update({
      where: { id: args.lineItemId },
      data: {
        status: "CONFIRMED",
        prepStatus: "PACKED",
        ...(args.prepContainer !== undefined
          ? { prepContainer: args.prepContainer }
          : {}),
      },
    });
  }

  await syncLineItemRollup(tx, args.lineItemId);
  return tx.projectLineItem.findUniqueOrThrow({
    where: { id: args.lineItemId },
    include: { model: true, asset: true, bulkAsset: true },
  });
}
