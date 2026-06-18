"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  kitSchema,
  kitSerializedItemSchema,
  kitBulkItemSchema,
  type KitFormValues,
  type KitSerializedItemFormValues,
  type KitBulkItemFormValues,
} from "@/lib/validations/kit";
import { serialize } from "@/lib/serialize";
import { reserveAssetTags } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import {
  mirrorKitCreate,
  patchKitInConvex,
  removeKitFromConvex,
  mirrorKitSerializedItemCreate,
  removeKitSerializedItemFromConvex,
  mirrorKitBulkItemCreate,
  removeKitBulkItemFromConvex,
} from "@/lib/kit-mirror";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { syncAssetsToConvex, syncBulkAssetsToConvex } from "@/lib/asset-mirror";
import { syncMediaForParent } from "@/lib/media-mirror";
import { getPrimaryPhotoMap } from "@/lib/media-read";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getLocationMap } from "@/lib/locations-read";
import { getCategoryMap } from "@/lib/categories-read";
import { getAssetsByOrg, getBulkAssetsByOrg, filterAvailableAssetsForKit, filterAvailableBulkAssetsForKit, sortByAssetTagAsc } from "@/lib/assets-read";
import { getKitSerializedItemsByOrg, getKitBulkItemsByOrg, countKitMembers, getKitById, coerceKitDeletabilityRow, computeKitDeletability } from "@/lib/kits-read";

/**
 * Per-kit member-item counts + primary photo (kitId -> meta).
 * Cross-domain for the counts (kit member tables come off the fresh Prisma
 * mirror); the primary photo comes off the Convex `kitMedia` + `fileUploads`
 * mirror via getPrimaryPhotoMap (Phase 6 decommission — kit_media is now
 * dual-written). Used by the reactive kit table, which subscribes to the kit
 * list via Convex and merges these (non-reactive) values in. Excludes prep-kits
 * (isPrep) to match the kit list.
 *
 * Phase A: the member counts now come off the dual-written Convex
 * `kitSerializedItems` / `kitBulkItems` lists (counted in JS by countKitMembers)
 * instead of two Prisma `groupBy`s; the primary photo already came from Convex.
 */
export async function getKitCounts(): Promise<
  Record<string, { serializedItems: number; bulkItems: number; media: { url: string | null; thumbnailUrl: string | null } | null }>
> {
  const { organizationId } = await getOrgContext();
  const [serializedItems, bulkItems, photoMap] = await Promise.all([
    getKitSerializedItemsByOrg(organizationId),
    getKitBulkItemsByOrg(organizationId),
    getPrimaryPhotoMap("kit", organizationId),
  ]);
  const memberCounts = countKitMembers(serializedItems, bulkItems);
  const out: Record<string, { serializedItems: number; bulkItems: number; media: { url: string | null; thumbnailUrl: string | null } | null }> = {};
  const ensure = (id: string) => (out[id] ??= { serializedItems: 0, bulkItems: 0, media: null });
  for (const [kitId, c] of Object.entries(memberCounts)) {
    const e = ensure(kitId);
    e.serializedItems = c.serializedItems;
    e.bulkItems = c.bulkItems;
  }
  for (const [kitId, meta] of Object.entries(photoMap)) ensure(kitId).media = meta;
  return serialize(out);
}

// Single kit with all relations.
export async function getKit(id: string) {
  const { organizationId } = await getOrgContext();

  const kit = await prisma.kit.findUnique({
    where: { id, organizationId },
    include: {
      serializedItems: {
        include: { asset: true },
      },
      bulkItems: {
        include: { bulkAsset: true },
      },
      lineItems: {
        take: 20,
        orderBy: { createdAt: "desc" },
        include: { project: true },
      },
      scanLogs: {
        take: 20,
        orderBy: { scannedAt: "desc" },
        include: { scannedBy: true, project: true },
      },
      maintenanceRecords: {
        take: 20,
        orderBy: { createdAt: "desc" },
      },
      media: {
        include: { file: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!kit) return serialize(null);
  const modelMap = await getModelMap(organizationId);
  // Location + Category FKs were dropped (Phase B); attach both from the Convex mirror.
  const location = kit.locationId
    ? (await getLocationMap(organizationId)).get(kit.locationId) ?? null
    : null;
  const category = kit.categoryId
    ? (await getCategoryMap(organizationId)).get(kit.categoryId) ?? null
    : null;
  return serialize({
    ...kit,
    location,
    category,
    serializedItems: kit.serializedItems.map((si) => ({
      ...si,
      asset: {
        ...si.asset,
        model: si.asset.modelId ? modelMap.get(si.asset.modelId) ?? null : null,
      },
    })),
    bulkItems: kit.bulkItems.map((bi) => ({
      ...bi,
      bulkAsset: {
        ...bi.bulkAsset,
        model: bi.bulkAsset.modelId ? modelMap.get(bi.bulkAsset.modelId) ?? null : null,
      },
    })),
  });
}

export async function createKit(data: KitFormValues) {
  const { organizationId, userId, userName } = await requirePermission("kit", "create");
  const parsed = kitSchema.parse(data);

  try {
    const result = await prisma.kit.create({
      data: {
        organizationId,
        name: parsed.name,
        assetTag: parsed.assetTag,
        description: parsed.description,
        categoryId: parsed.categoryId || null,
        status: parsed.status,
        condition: parsed.condition,
        locationId: parsed.locationId || null,
        weight: parsed.weight,
        caseType: parsed.caseType,
        caseDimensions: parsed.caseDimensions,
        notes: parsed.notes,
        purchaseDate: parsed.purchaseDate,
        purchasePrice: parsed.purchasePrice,
        image: parsed.image,
        images: parsed.images,
        barcode: parsed.assetTag,
        qrCode: parsed.assetTag,
        isActive: parsed.isActive,
        tags: parsed.tags,
        checkMode: parsed.checkMode,
      },
    });
    await reserveAssetTags(1);
    await mirrorKitCreate(result);

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "kit",
      entityId: result.id,
      entityName: result.assetTag,
      summary: `Created kit ${result.assetTag} - ${result.name}`,
      details: { created: { assetTag: result.assetTag, name: result.name } },
      kitId: result.id,
    });

    return serialize(result);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      throw new Error(`Asset tag "${parsed.assetTag}" already exists`);
    }
    throw e;
  }
}

export async function updateKit(id: string, data: KitFormValues) {
  const { organizationId, userId, userName } = await requirePermission("kit", "update");
  const parsed = kitSchema.parse(data);

  const updated = await prisma.kit.update({
    where: { id, organizationId },
    data: {
      name: parsed.name,
      assetTag: parsed.assetTag,
      description: parsed.description,
      categoryId: parsed.categoryId || null,
      status: parsed.status,
      condition: parsed.condition,
      locationId: parsed.locationId || null,
      weight: parsed.weight,
      caseType: parsed.caseType,
      caseDimensions: parsed.caseDimensions,
      notes: parsed.notes,
      purchaseDate: parsed.purchaseDate,
      purchasePrice: parsed.purchasePrice,
      image: parsed.image,
      images: parsed.images,
      isActive: parsed.isActive,
      tags: parsed.tags,
      checkMode: parsed.checkMode,
    },
  });
  await patchKitInConvex(updated.id, updated);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: updated.id,
    entityName: updated.assetTag,
    summary: `Updated kit ${updated.assetTag} - ${updated.name}`,
    kitId: updated.id,
  });

  return serialize(updated);
}

export async function updateKitNotes(id: string, notes: string) {
  const { organizationId } = await requirePermission("kit", "update");
  const updated = await prisma.kit.update({
    where: { id, organizationId },
    data: { notes: notes || null },
  });
  await patchKitInConvex(updated.id, updated);
  return serialize(updated);
}

// ---------------------------------------------------------------------------
// archiveKit – soft delete: remove all contents, then deactivate
// ---------------------------------------------------------------------------
export async function archiveKit(id: string) {
  const { organizationId, userId, userName } = await requirePermission("kit", "delete");

  const kit = await prisma.kit.findUnique({
    where: { id, organizationId },
    include: {
      serializedItems: { include: { asset: true } },
      bulkItems: true,
    },
  });

  if (!kit) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Only AVAILABLE kits can be archived");
  }

  const archived = await prisma.$transaction(async (tx) => {
    // Clear kitId on all serialized assets
    for (const item of kit.serializedItems) {
      await tx.asset.update({
        where: { id: item.assetId },
        data: { kitId: null, status: "AVAILABLE" },
      });
    }
    // Delete all serialized items
    await tx.kitSerializedItem.deleteMany({ where: { kitId: id } });

    // Return bulk quantities
    for (const item of kit.bulkItems) {
      await tx.bulkAsset.update({
        where: { id: item.bulkAssetId },
        data: { availableQuantity: { increment: item.quantity } },
      });
    }
    // Delete all bulk items
    await tx.kitBulkItem.deleteMany({ where: { kitId: id } });

    // Soft-delete the kit
    return tx.kit.update({
      where: { id, organizationId },
      data: { isActive: false, status: "RETIRED" },
    });
  });

  // Mirror to Convex: the kit's member items were removed and the kit was
  // soft-deleted (status/isActive patched, not deleted — the row remains). The
  // released serialized assets (kitId→null, AVAILABLE) and restored bulk
  // quantities are reactive too.
  for (const item of kit.serializedItems) await removeKitSerializedItemFromConvex(item.id);
  for (const item of kit.bulkItems) await removeKitBulkItemFromConvex(item.id);
  await patchKitInConvex(archived.id, archived);
  await syncAssetsToConvex(kit.serializedItems.map((i) => i.assetId));
  await syncBulkAssetsToConvex(kit.bulkItems.map((i) => i.bulkAssetId));

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "kit",
    entityId: id,
    entityName: kit.assetTag,
    summary: `Archived kit ${kit.assetTag} - ${kit.name}`,
    kitId: id,
  });

  return serialize(archived);
}

// ---------------------------------------------------------------------------
// canDeleteKit – predicate for UI to decide which delete options are available
// ---------------------------------------------------------------------------
export async function canDeleteKit(id: string) {
  const { organizationId } = await requirePermission("kit", "delete");

  // The kit row comes off Convex (the dual-written reactive mirror); a miss
  // reads null with no Prisma fallback (a fallback would mask mirror drift).
  const convexKit = await getKitById(id);
  if (!convexKit || convexKit.organizationId !== organizationId) {
    throw new Error("Kit not found");
  }

  // ProjectLineItem references stay on Prisma until the keystone
  // project-line-item tree migrates (see FEATUREDOCS/54).
  const referencingLineItems = await prisma.projectLineItem.count({
    where: { kitId: id, organizationId },
  });

  return serialize(
    computeKitDeletability(coerceKitDeletabilityRow(convexKit), referencingLineItems),
  );
}

// ---------------------------------------------------------------------------
// deleteKit – hard delete. Releases contents then removes the kit row entirely.
// Blocked if the kit is referenced by any ProjectLineItem, regardless of status,
// to preserve historical project data. Use archiveKit for the reversible path.
// ---------------------------------------------------------------------------
export async function deleteKit(id: string) {
  const { organizationId, userId, userName } = await requirePermission("kit", "delete");

  const kit = await prisma.kit.findUnique({
    where: { id, organizationId },
    include: {
      serializedItems: true,
      bulkItems: true,
    },
  });
  if (!kit) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Only AVAILABLE kits can be deleted");
  }

  const referencingLineItems = await prisma.projectLineItem.count({
    where: { kitId: id, organizationId },
  });
  if (referencingLineItems > 0) {
    throw new Error(
      `This kit is referenced by ${referencingLineItems} project line item${
        referencingLineItems === 1 ? "" : "s"
      }. Archive it instead, or remove it from those projects first.`,
    );
  }

  const tagForLog = kit.assetTag;
  const nameForLog = kit.name;

  // Capture kit_check_item ids before the cascade delete (Convex has no FK cascade).
  const convexKits = await getConvexClient();
  const kitCheckItemRows = await convexKits.query(api.kitCheckItems.listByKitId, { orgId: organizationId, kitId: id });

  await prisma.$transaction(async (tx) => {
    // Release serialized assets back to inventory.
    for (const item of kit.serializedItems) {
      await tx.asset.update({
        where: { id: item.assetId },
        data: { kitId: null, status: "AVAILABLE" },
      });
    }
    await tx.kitSerializedItem.deleteMany({ where: { kitId: id } });

    // Return bulk quantities to their source bulk assets.
    for (const item of kit.bulkItems) {
      await tx.bulkAsset.update({
        where: { id: item.bulkAssetId },
        data: { availableQuantity: { increment: item.quantity } },
      });
    }
    await tx.kitBulkItem.deleteMany({ where: { kitId: id } });

    // Clean up kit-scoped metadata. KitMedia rows reference S3 files — we drop
    // the DB rows here and rely on the nightly orphan sweep (or leave the S3
    // files). Full media cleanup can be layered on later if it becomes a
    // concern; hard delete is a rarely-used path.
    await tx.kitCheckItem.deleteMany({ where: { kitId: id } });
    await tx.kitMedia.deleteMany({ where: { kitId: id } });

    // Finally, remove the kit row. Cascades handle the remaining child relations.
    await tx.kit.delete({ where: { id, organizationId } });
  });

  // Mirror the hard delete to Convex (member items + check items first, then the
  // kit). kit_media is dual-written, so reconcile it too (Prisma rows for this
  // kit are gone → all of the kit's Convex kitMedia rows are removed). The
  // released assets / restored bulk quantities are reactive too.
  for (const item of kit.serializedItems) await removeKitSerializedItemFromConvex(item.id);
  for (const item of kit.bulkItems) await removeKitBulkItemFromConvex(item.id);
  for (const row of kitCheckItemRows) await convexKits.mutation(api.kitCheckItems.remove, { id: row.id });
  await syncMediaForParent("kit", organizationId, id);
  await removeKitFromConvex(id);
  await syncAssetsToConvex(kit.serializedItems.map((i) => i.assetId));
  await syncBulkAssetsToConvex(kit.bulkItems.map((i) => i.bulkAssetId));

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "kit",
    entityId: id,
    entityName: tagForLog,
    summary: `Permanently deleted kit ${tagForLog} - ${nameForLog}`,
  });

  return serialize({ id, hardDeleted: true });
}

export async function addSerializedItemToKit(
  kitId: string,
  data: KitSerializedItemFormValues,
) {
  const { organizationId, userId } = await requirePermission("kit", "update");
  const parsed = kitSerializedItemSchema.parse(data);

  const kit = await prisma.kit.findUnique({
    where: { id: kitId, organizationId },
  });
  if (!kit) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Items can only be added to AVAILABLE kits");
  }

  const asset = await prisma.asset.findUnique({
    where: { id: parsed.assetId, organizationId },
  });
  if (!asset) throw new Error("Asset not found");
  if (asset.status !== "AVAILABLE") {
    throw new Error("Asset is not AVAILABLE");
  }
  if (asset.kitId) {
    throw new Error("Asset is already assigned to another kit");
  }
  if (asset.parentAssetId) {
    throw new Error("Asset is an accessory of another asset — detach it first");
  }

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.kitSerializedItem.create({
      data: {
        organizationId,
        kitId,
        assetId: parsed.assetId,
        position: parsed.position,
        notes: parsed.notes,
        addedById: userId,
      },
      include: { asset: true },
    });

    await tx.asset.update({
      where: { id: parsed.assetId },
      data: { kitId, locationId: kit.locationId },
    });

    return created;
  });

  // Mirror the member row to Convex (strip the nested asset relation) + the
  // asset's kitId/location change.
  const { asset: _asset, ...itemRow } = item;
  await mirrorKitSerializedItemCreate(itemRow);
  await syncAssetsToConvex([parsed.assetId]);

  const assetModel = item.asset.modelId ? await getModelById(item.asset.modelId) : null;
  return serialize({ ...item, asset: { ...item.asset, model: assetModel } });
}

// Batch add multiple serialized assets.
export async function addSerializedItemsToKit(
  kitId: string,
  items: Array<{ assetId: string; position?: string }>,
) {
  const { organizationId, userId } = await requirePermission("kit", "update");

  if (items.length === 0) throw new Error("No items to add");

  const kit = await prisma.kit.findUnique({
    where: { id: kitId, organizationId },
  });
  if (!kit) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Items can only be added to AVAILABLE kits");
  }

  const assetIds = items.map((i) => i.assetId);
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, organizationId },
  });

  for (const asset of assets) {
    if (asset.status !== "AVAILABLE") {
      throw new Error(`Asset ${asset.assetTag} is not AVAILABLE`);
    }
    if (asset.kitId) {
      throw new Error(`Asset ${asset.assetTag} is already in another kit`);
    }
    if (asset.parentAssetId) {
      throw new Error(`Asset ${asset.assetTag} is an accessory — detach it first`);
    }
  }

  if (assets.length !== assetIds.length) {
    throw new Error("One or more assets were not found");
  }

  const created = await prisma.$transaction(async (tx) => {
    const records = [];
    for (const item of items) {
      const record = await tx.kitSerializedItem.create({
        data: {
          organizationId,
          kitId,
          assetId: item.assetId,
          position: item.position,
          addedById: userId,
        },
        include: { asset: true },
      });
      await tx.asset.update({
        where: { id: item.assetId },
        data: { kitId, locationId: kit.locationId },
      });
      records.push(record);
    }
    return records;
  });

  // Mirror each member row to Convex (strip the nested asset relation) + the
  // assets' kitId/location changes.
  for (const record of created) {
    const { asset: _asset, ...itemRow } = record;
    await mirrorKitSerializedItemCreate(itemRow);
  }
  await syncAssetsToConvex(items.map((i) => i.assetId));

  const modelMap = await getModelMap(organizationId);
  return serialize(created.map((r) => ({
    ...r,
    asset: { ...r.asset, model: r.asset.modelId ? modelMap.get(r.asset.modelId) ?? null : null },
  })));
}

export async function removeSerializedItemFromKit(
  kitId: string,
  assetId: string,
) {
  const { organizationId } = await requirePermission("kit", "update");

  const kit = await prisma.kit.findUnique({
    where: { id: kitId, organizationId },
  });
  if (!kit) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Items can only be removed from AVAILABLE kits");
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const removed = await tx.kitSerializedItem.delete({
      where: { organizationId_assetId: { organizationId, assetId } },
    });

    await tx.asset.update({
      where: { id: assetId },
      data: { kitId: null, status: "AVAILABLE" },
    });

    return removed;
  });

  await removeKitSerializedItemFromConvex(deleted.id);
  await syncAssetsToConvex([assetId]);

  return serialize({ success: true });
}

export async function addBulkItemToKit(
  kitId: string,
  data: KitBulkItemFormValues,
) {
  const { organizationId, userId } = await requirePermission("kit", "update");
  const parsed = kitBulkItemSchema.parse(data);

  const kit = await prisma.kit.findUnique({
    where: { id: kitId, organizationId },
  });
  if (!kit) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Items can only be added to AVAILABLE kits");
  }

  const bulkAsset = await prisma.bulkAsset.findUnique({
    where: { id: parsed.bulkAssetId, organizationId },
  });
  if (!bulkAsset) throw new Error("Bulk asset not found");
  if (bulkAsset.availableQuantity < parsed.quantity) {
    throw new Error(
      `Insufficient quantity: only ${bulkAsset.availableQuantity} available`,
    );
  }

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.kitBulkItem.create({
      data: {
        organizationId,
        kitId,
        bulkAssetId: parsed.bulkAssetId,
        quantity: parsed.quantity,
        position: parsed.position,
        notes: parsed.notes,
        addedById: userId,
      },
      include: { bulkAsset: true },
    });

    await tx.bulkAsset.update({
      where: { id: parsed.bulkAssetId },
      data: { availableQuantity: { decrement: parsed.quantity } },
    });

    return created;
  });

  // Mirror the member row to Convex (strip the nested bulkAsset relation) + the
  // bulk asset's availableQuantity decrement.
  const { bulkAsset: _bulkAsset, ...itemRow } = item;
  await mirrorKitBulkItemCreate(itemRow);
  await syncBulkAssetsToConvex([parsed.bulkAssetId]);

  const bulkAssetModel = item.bulkAsset.modelId ? await getModelById(item.bulkAsset.modelId) : null;
  return serialize({ ...item, bulkAsset: { ...item.bulkAsset, model: bulkAssetModel } });
}

export async function removeBulkItemFromKit(
  kitId: string,
  bulkItemId: string,
) {
  const { organizationId } = await requirePermission("kit", "update");

  const kit = await prisma.kit.findUnique({
    where: { id: kitId, organizationId },
  });
  if (!kit) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Items can only be removed from AVAILABLE kits");
  }

  const bulkAssetId = await prisma.$transaction(async (tx) => {
    const bulkItem = await tx.kitBulkItem.findUnique({
      where: { id: bulkItemId, organizationId },
    });
    if (!bulkItem) throw new Error("Bulk item not found");
    if (bulkItem.kitId !== kitId) throw new Error("Bulk item does not belong to this kit");

    await tx.kitBulkItem.delete({ where: { id: bulkItemId, organizationId } });

    await tx.bulkAsset.update({
      where: { id: bulkItem.bulkAssetId },
      data: { availableQuantity: { increment: bulkItem.quantity } },
    });

    return bulkItem.bulkAssetId;
  });

  await removeKitBulkItemFromConvex(bulkItemId);
  await syncBulkAssetsToConvex([bulkAssetId]);

  return serialize({ success: true });
}

// Serialized assets not in any kit. Reads off the dual-written Convex `assets`
// list; the eligibility where + assetTag sort are replicated by the pure
// filterAvailableAssetsForKit / sortByAssetTagAsc helpers (Phase A).
export async function getAvailableAssetsForKit(modelId?: string) {
  const { organizationId } = await getOrgContext();

  const [allAssets, modelMap] = await Promise.all([
    getAssetsByOrg(organizationId),
    getModelMap(organizationId),
  ]);
  const assets = sortByAssetTagAsc(filterAvailableAssetsForKit(allAssets, modelId));
  return serialize(assets.map((a) => ({
    ...a,
    model: a.modelId ? modelMap.get(a.modelId) ?? null : null,
  })));
}

// Bulk assets with available quantity. Reads off the dual-written Convex
// `bulkAssets` list; eligibility + sort via the pure helpers (Phase A).
export async function getAvailableBulkAssetsForKit() {
  const { organizationId } = await getOrgContext();

  const [allBulkAssets, modelMap] = await Promise.all([
    getBulkAssetsByOrg(organizationId),
    getModelMap(organizationId),
  ]);
  const bulkAssets = sortByAssetTagAsc(filterAvailableBulkAssetsForKit(allBulkAssets));
  return serialize(bulkAssets.map((b) => ({
    ...b,
    model: b.modelId ? modelMap.get(b.modelId) ?? null : null,
  })));
}


