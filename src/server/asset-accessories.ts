"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getAssetById, getAssetsByOrg, getBulkAssetById } from "@/lib/assets-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import {
  assetSerializedChildSchema,
  assetBulkChildSchema,
  type AssetSerializedChildFormValues,
  type AssetBulkChildFormValues,
} from "@/lib/validations/asset";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { adjustBulkAvailability } from "@/lib/inventory-mutations";
import { syncAssetsToConvex, syncBulkAssetsToConvex } from "@/lib/asset-mirror";
import { UserFacingError } from "@/lib/errors";

/**
 * Serialised assets eligible to become an accessory of `parentAssetId`:
 * AVAILABLE, not in a kit, not already an accessory, not the parent itself,
 * and not a parent of accessories themselves (one level deep).
 */
export async function getAvailableAccessoryAssets(parentAssetId: string) {
  const { organizationId } = await getOrgContext();
  // Cross-domain reads now come from the Convex mirror.
  const [allAssets, bulkChildren] = await Promise.all([
    getAssetsByOrg(organizationId),
    // assetBulkChildren is in Convex (table "assetBulkChildren"); used to satisfy
    // the relational `childBulkItems: { none: {} }` existence check below.
    (await getConvexClient()).query(api.assetBulkChildren.list, { orgId: organizationId }),
  ]);

  // Relational existence checks (Prisma `childAssets: { none: {} }` and
  // `childBulkItems: { none: {} }`) reframed as "is this asset a parent of any
  // accessory?": collect every asset id that some other asset / bulk-child points
  // at as its parent, then exclude those ids.
  const parentIds = new Set<string>();
  for (const a of allAssets) {
    if (a.parentAssetId) parentIds.add(a.parentAssetId);
  }
  for (const c of bulkChildren) {
    if (c.parentAssetId) parentIds.add(c.parentAssetId);
  }

  const assets = allAssets
    .filter(
      (a) =>
        a.isActive !== false &&
        a.status === "AVAILABLE" &&
        !a.kitId &&
        !a.parentAssetId &&
        a.id !== parentAssetId &&
        !parentIds.has(a.id),
    )
    .sort((x, y) => x.assetTag.localeCompare(y.assetTag));

  const modelMap = await getModelMap(organizationId);
  return serialize(assets.map((a) => ({ ...a, model: a.modelId ? modelMap.get(a.modelId) ?? null : null })));
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

  const parentDoc = await getAssetById(parentAssetId);
  // getAssetById does not scope by org — treat an org mismatch as not-found.
  const parent = parentDoc && parentDoc.organizationId === organizationId ? parentDoc : null;
  if (!parent) throw new UserFacingError({ code: "NOT_FOUND", title: "Asset not found", message: "The parent asset no longer exists." });
  if (parent.parentAssetId) {
    throw new UserFacingError({
      code: "ACCESSORY_NESTED",
      title: "Cannot nest accessories",
      message: "This asset is itself an accessory. Attach accessories to a top-level asset instead.",
    });
  }

  const childDoc = await getAssetById(parsed.childAssetId);
  const child = childDoc && childDoc.organizationId === organizationId ? childDoc : null;
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
  // `_count.childAssets / childBulkItems > 0` reframed as Convex existence checks:
  // is this child itself a parent of any serialised or bulk accessory?
  const [orgAssets, orgBulkChildren] = await Promise.all([
    getAssetsByOrg(organizationId),
    (await getConvexClient()).query(api.assetBulkChildren.list, { orgId: organizationId }),
  ]);
  const childIsParent =
    orgAssets.some((a) => a.parentAssetId === child.id) ||
    orgBulkChildren.some((c) => c.parentAssetId === child.id);
  if (childIsParent) {
    throw new UserFacingError({ code: "ACCESSORY_IS_PARENT", title: "Asset has its own accessories", message: `${child.assetTag} has accessories of its own. Detach them first, or attach a different asset.` });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Guarded write: re-assert the pre-check conditions in the WHERE so two
    // concurrent attaches of the same child (to different parents) can't both
    // win — the second sees count 0 and rolls back.
    const guarded = await tx.asset.updateMany({
      where: { id: child.id, organizationId, parentAssetId: null, kitId: null, status: "AVAILABLE" },
      // Child physically lives with the parent → inherit its location.
      data: { parentAssetId, locationId: parent.locationId, notes: parsed.notes ? parsed.notes : undefined },
    });
    if (guarded.count === 0) {
      throw new UserFacingError({ code: "ACCESSORY_TAKEN", title: "Already attached", message: `${child.assetTag} was just attached elsewhere. Refresh and try again.` });
    }
    return tx.asset.findUniqueOrThrow({ where: { id: child.id } });
  });
  const [, model] = await Promise.all([
    syncAssetsToConvex([child.id]),
    getModelById(result.modelId),
  ]);

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

  return serialize({ ...result, model });
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

  const parentDoc = await getAssetById(parentAssetId);
  // getAssetById does not scope by org — treat an org mismatch as not-found.
  const parent = parentDoc && parentDoc.organizationId === organizationId ? parentDoc : null;
  if (!parent) throw new UserFacingError({ code: "NOT_FOUND", title: "Asset not found", message: "The parent asset no longer exists." });
  if (parent.parentAssetId) {
    throw new UserFacingError({
      code: "ACCESSORY_NESTED",
      title: "Cannot nest accessories",
      message: "This asset is itself an accessory. Attach accessories to a top-level asset instead.",
    });
  }

  const bulkAssetDoc = await getBulkAssetById(parsed.bulkAssetId);
  const bulkAsset = bulkAssetDoc && bulkAssetDoc.organizationId === organizationId ? bulkAssetDoc : null;
  if (!bulkAsset) throw new UserFacingError({ code: "NOT_FOUND", title: "Bulk asset not found", message: "The bulk accessory no longer exists." });

  const convex = await getConvexClient();

  // maxSort from Convex (assetBulkChild is Convex-only after Phase B).
  const existingChildren = await convex.query(api.assetBulkChildren.list, { orgId: organizationId });
  const parentChildren = existingChildren.filter((c) => c.parentAssetId === parentAssetId);
  const sortOrder = parentChildren.reduce((max, c) => Math.max(max, c.sortOrder ?? -1), -1) + 1;

  const bulkChildId = createId();
  const now = Date.now();

  // DEDICATED mode: deduct from the shared pool atomically in Prisma (bulkAsset
  // is still dual-written). Convex quantity mirror follows after.
  if (parsed.allocationMode === "DEDICATED") {
    await prisma.$transaction(async (tx) => {
      await adjustBulkAvailability(tx, organizationId, [
        { bulkAssetId: parsed.bulkAssetId, delta: -parsed.quantity },
      ]);
    });
  }

  await convex.mutation(api.assetBulkChildren.createIfMissing, {
    id: bulkChildId,
    organizationId,
    parentAssetId,
    bulkAssetId: parsed.bulkAssetId,
    quantity: parsed.quantity,
    allocationMode: parsed.allocationMode,
    sortOrder,
    notes: parsed.notes ?? undefined,
    addedAt: now,
    addedById: userId,
  });

  const [, bulkModel] = await Promise.all([
    parsed.allocationMode === "DEDICATED" ? syncBulkAssetsToConvex([parsed.bulkAssetId]) : Promise.resolve(),
    getModelById(bulkAsset.modelId),
  ]);

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

  return serialize({
    id: bulkChildId,
    organizationId,
    parentAssetId,
    bulkAssetId: parsed.bulkAssetId,
    quantity: parsed.quantity,
    allocationMode: parsed.allocationMode,
    sortOrder,
    notes: parsed.notes ?? null,
    addedAt: new Date(now),
    addedById: userId,
    bulkAsset: { ...bulkAsset, model: bulkModel },
  });
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

  const childDoc = await getAssetById(childAssetId);
  // getAssetById does not scope by org — treat an org mismatch as not-found.
  const child = childDoc && childDoc.organizationId === organizationId ? childDoc : null;
  if (!child || child.parentAssetId !== parentAssetId) {
    throw new UserFacingError({ code: "NOT_FOUND", title: "Accessory not found", message: "That accessory is not attached to this asset." });
  }
  // Don't detach while the accessory is out on a job — detaching a deployed
  // asset would leave its project child line dangling and mis-state the shelf.
  if (child.status !== "AVAILABLE") {
    throw new UserFacingError({ code: "ACCESSORY_DEPLOYED", title: "Accessory is in use", message: `${child.assetTag} is ${(child.status ?? "unavailable").replace("_", " ").toLowerCase()} — return it before detaching.` });
  }

  await prisma.asset.update({
    where: { id: childAssetId },
    data: { parentAssetId: null },
  });
  // Mirror to Convex. NB: clearing parentAssetId→null is a no-op in Convex
  // (toConvexDoc drops null→absent and the patch validator is v.optional, which
  // rejects null) — the documented clear-to-null limitation. The Convex doc keeps
  // its stale parentAssetId until the next non-null write or a backfill run. The
  // reactive registry tolerates this; see src/lib/asset-mirror.ts + FEATUREDOCS/54.
  await syncAssetsToConvex([childAssetId]);

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

  const convex = await getConvexClient();
  const bulkChild = await convex.query(api.assetBulkChildren.getById, { id: bulkChildId });
  if (
    !bulkChild ||
    bulkChild.organizationId !== organizationId ||
    bulkChild.parentAssetId !== parentAssetId
  ) {
    throw new UserFacingError({ code: "NOT_FOUND", title: "Accessory not found", message: "That accessory is not attached to this asset." });
  }
  const bulkAssetDoc = await getBulkAssetById(bulkChild.bulkAssetId);

  if (bulkChild.allocationMode === "DEDICATED") {
    // Return the dedicated quantity to the shared pool atomically in Prisma.
    await prisma.$transaction(async (tx) => {
      await adjustBulkAvailability(tx, organizationId, [
        { bulkAssetId: bulkChild.bulkAssetId, delta: bulkChild.quantity },
      ]);
    });
  }
  await convex.mutation(api.assetBulkChildren.remove, { id: bulkChildId });
  // DEDICATED allocation returned stock to the shared pool — mirror the quantity.
  if (bulkChild.allocationMode === "DEDICATED") await syncBulkAssetsToConvex([bulkChild.bulkAssetId]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: parentAssetId,
    entityName: bulkAssetDoc?.assetTag ?? bulkChild.bulkAssetId,
    summary: `Detached ${bulkChild.quantity}× ${bulkAssetDoc?.assetTag ?? bulkChild.bulkAssetId}`,
    details: { accessory: { bulkAssetId: bulkChild.bulkAssetId, quantity: bulkChild.quantity } },
    assetId: parentAssetId,
  });

  return serialize({ success: true });
}
