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
    select: { status: true },
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
 * Mark a unit prepped/packed (the pick-and-pack step before checkout).
 * Serialised and bulk lines get a PACKED unit row; a generic line with no
 * asset assigned just carries prepStatus on the order line. Rolls the line
 * up and returns it (with model/asset/bulkAsset included).
 */
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
