"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import {
  assetSerializedChildSchema,
  assetBulkChildSchema,
  type AssetSerializedChildFormValues,
  type AssetBulkChildFormValues,
} from "@/lib/validations/asset";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { adjustBulkAvailability } from "@/lib/inventory-mutations";
import { UserFacingError } from "@/lib/errors";

/**
 * Serialised assets eligible to become an accessory of `parentAssetId`:
 * AVAILABLE, not in a kit, not already an accessory, not the parent itself,
 * and not a parent of accessories themselves (one level deep).
 */
export async function getAvailableAccessoryAssets(parentAssetId: string) {
  const { organizationId } = await getOrgContext();
  return serialize(
    await prisma.asset.findMany({
      where: {
        organizationId,
        isActive: true,
        status: "AVAILABLE",
        kitId: null,
        parentAssetId: null,
        id: { not: parentAssetId },
        childAssets: { none: {} },
        childBulkItems: { none: {} },
      },
      include: { model: { select: { name: true, manufacturer: true } } },
      orderBy: { assetTag: "asc" },
    }),
  );
}

/**
 * Child assets / accessories.
 *
 * A serialised asset (the parent) can have permanently-attached accessories:
 * - serialised children (a specific cable tracked individually) via
 *   Asset.parentAssetId,
 * - bulk children (e.g. 2 clamps) via the AssetBulkChild join table.
 *
 * Accessories travel with the parent onto projects and through the warehouse.
 * They are not independently bookable; a child's registry row is flagged
 * "Attached to <parent>" and excluded from availability searches.
 */

/**
 * Attach a serialised asset as an accessory of a parent asset.
 *
 * Guards (data integrity, per eng review):
 * - parent + child both exist and are in the caller's org (no cross-org attach),
 * - child is AVAILABLE,
 * - child is not already an accessory of another parent,
 * - child is not a kit member (the kit↔accessory dual-membership guard; the
 *   symmetric check lives in addSerializedItemToKit),
 * - child is not itself an accessory parent (one level deep — no nesting/cycles),
 * - child !== parent.
 */
export async function addSerializedChildToAsset(
  parentAssetId: string,
  data: AssetSerializedChildFormValues,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "asset",
    "update",
  );
  const parsed = assetSerializedChildSchema.parse(data);

  if (parsed.childAssetId === parentAssetId) {
    throw new UserFacingError({
      code: "ACCESSORY_SELF",
      title: "Cannot attach an asset to itself",
      message: "Pick a different asset as the accessory.",
    });
  }

  const parent = await prisma.asset.findUnique({
    where: { id: parentAssetId, organizationId },
    select: { id: true, assetTag: true, locationId: true, parentAssetId: true },
  });
  if (!parent) throw new UserFacingError({ code: "NOT_FOUND", title: "Asset not found", message: "The parent asset no longer exists." });
  if (parent.parentAssetId) {
    throw new UserFacingError({
      code: "ACCESSORY_NESTED",
      title: "Cannot nest accessories",
      message: "This asset is itself an accessory. Attach accessories to a top-level asset instead.",
    });
  }

  const child = await prisma.asset.findUnique({
    where: { id: parsed.childAssetId, organizationId },
    select: {
      id: true,
      assetTag: true,
      status: true,
      kitId: true,
      parentAssetId: true,
      _count: { select: { childAssets: true, childBulkItems: true } },
    },
  });
  if (!child) throw new UserFacingError({ code: "NOT_FOUND", title: "Accessory not found", message: "The accessory asset no longer exists." });
  if (child.status !== "AVAILABLE") {
    throw new UserFacingError({ code: "ACCESSORY_UNAVAILABLE", title: "Accessory not available", message: `${child.assetTag} must be AVAILABLE to attach.` });
  }
  if (child.parentAssetId) {
    throw new UserFacingError({ code: "ACCESSORY_TAKEN", title: "Already an accessory", message: `${child.assetTag} is already attached to another asset.` });
  }
  if (child.kitId) {
    throw new UserFacingError({ code: "ACCESSORY_IN_KIT", title: "Asset is in a kit", message: `${child.assetTag} belongs to a kit and can't also be an accessory.` });
  }
  if (child._count.childAssets > 0 || child._count.childBulkItems > 0) {
    throw new UserFacingError({ code: "ACCESSORY_IS_PARENT", title: "Asset has its own accessories", message: `${child.assetTag} has accessories of its own. Detach them first, or attach a different asset.` });
  }

  const result = await prisma.$transaction(async (tx) => {
    return tx.asset.update({
      where: { id: child.id },
      // Child physically lives with the parent → inherit its location.
      data: { parentAssetId, locationId: parent.locationId, notes: parsed.notes ? parsed.notes : undefined },
      include: { model: true },
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parent.id,
    entityName: parent.assetTag,
    summary: `Attached accessory ${child.assetTag} to ${parent.assetTag}`,
    details: { accessory: { childAssetId: child.id, childTag: child.assetTag } },
    assetId: parent.id,
  });

  return serialize(result);
}

/**
 * Attach a bulk asset as an accessory (e.g. "this light ships with 2 clamps").
 *
 * DEDICATED allocation decrements the shared pool now (guarded, race-safe via
 * adjustBulkAvailability) and is restored on detach. SHIPS_WITH leaves the pool
 * untouched — the quantity is drawn live at prep/checkout.
 */
export async function addBulkChildToAsset(
  parentAssetId: string,
  data: AssetBulkChildFormValues,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "asset",
    "update",
  );
  const parsed = assetBulkChildSchema.parse(data);

  const parent = await prisma.asset.findUnique({
    where: { id: parentAssetId, organizationId },
    select: { id: true, assetTag: true, parentAssetId: true },
  });
  if (!parent) throw new UserFacingError({ code: "NOT_FOUND", title: "Asset not found", message: "The parent asset no longer exists." });
  if (parent.parentAssetId) {
    throw new UserFacingError({
      code: "ACCESSORY_NESTED",
      title: "Cannot nest accessories",
      message: "This asset is itself an accessory. Attach accessories to a top-level asset instead.",
    });
  }

  const bulkAsset = await prisma.bulkAsset.findUnique({
    where: { id: parsed.bulkAssetId, organizationId },
    select: { id: true, assetTag: true },
  });
  if (!bulkAsset) throw new UserFacingError({ code: "NOT_FOUND", title: "Bulk asset not found", message: "The bulk accessory no longer exists." });

  const result = await prisma.$transaction(async (tx) => {
    if (parsed.allocationMode === "DEDICATED") {
      // Permanently pull the quantity out of the shared pool (guarded).
      await adjustBulkAvailability(tx, organizationId, [
        { bulkAssetId: parsed.bulkAssetId, delta: -parsed.quantity },
      ]);
    }

    const maxSort = await tx.assetBulkChild.aggregate({
      where: { parentAssetId },
      _max: { sortOrder: true },
    });

    return tx.assetBulkChild.create({
      data: {
        organizationId,
        parentAssetId,
        bulkAssetId: parsed.bulkAssetId,
        quantity: parsed.quantity,
        allocationMode: parsed.allocationMode,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        notes: parsed.notes,
        addedById: userId,
      },
      include: { bulkAsset: { include: { model: true } } },
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parent.id,
    entityName: parent.assetTag,
    summary: `Attached ${parsed.quantity}× ${bulkAsset.assetTag} to ${parent.assetTag} (${parsed.allocationMode})`,
    details: { accessory: { bulkAssetId: bulkAsset.id, quantity: parsed.quantity, allocationMode: parsed.allocationMode } },
    assetId: parent.id,
  });

  return serialize(result);
}

/** Detach a serialised accessory from its parent. */
export async function removeSerializedChildFromAsset(
  parentAssetId: string,
  childAssetId: string,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "asset",
    "update",
  );

  const child = await prisma.asset.findUnique({
    where: { id: childAssetId, organizationId },
    select: { id: true, assetTag: true, parentAssetId: true },
  });
  if (!child || child.parentAssetId !== parentAssetId) {
    throw new UserFacingError({ code: "NOT_FOUND", title: "Accessory not found", message: "That accessory is not attached to this asset." });
  }

  await prisma.asset.update({
    where: { id: childAssetId },
    data: { parentAssetId: null },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parentAssetId,
    entityName: child.assetTag,
    summary: `Detached accessory ${child.assetTag}`,
    details: { accessory: { childAssetId } },
    assetId: parentAssetId,
  });

  return serialize({ success: true });
}

/** Detach a bulk accessory; restores DEDICATED stock to the shared pool. */
export async function removeBulkChildFromAsset(
  parentAssetId: string,
  bulkChildId: string,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "asset",
    "update",
  );

  const bulkChild = await prisma.assetBulkChild.findUnique({
    where: { id: bulkChildId },
    select: {
      id: true,
      organizationId: true,
      parentAssetId: true,
      bulkAssetId: true,
      quantity: true,
      allocationMode: true,
      bulkAsset: { select: { assetTag: true } },
    },
  });
  if (
    !bulkChild ||
    bulkChild.organizationId !== organizationId ||
    bulkChild.parentAssetId !== parentAssetId
  ) {
    throw new UserFacingError({ code: "NOT_FOUND", title: "Accessory not found", message: "That accessory is not attached to this asset." });
  }

  await prisma.$transaction(async (tx) => {
    if (bulkChild.allocationMode === "DEDICATED") {
      // Return the dedicated quantity to the shared pool.
      await adjustBulkAvailability(tx, organizationId, [
        { bulkAssetId: bulkChild.bulkAssetId, delta: bulkChild.quantity },
      ]);
    }
    await tx.assetBulkChild.delete({ where: { id: bulkChildId } });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parentAssetId,
    entityName: bulkChild.bulkAsset.assetTag,
    summary: `Detached ${bulkChild.quantity}× ${bulkChild.bulkAsset.assetTag}`,
    details: { accessory: { bulkAssetId: bulkChild.bulkAssetId, quantity: bulkChild.quantity } },
    assetId: parentAssetId,
  });

  return serialize({ success: true });
}
