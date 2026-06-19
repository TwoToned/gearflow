"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import type { Prisma } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { reserveAssetTags, getOrgTestTagSettings } from "@/server/settings";
import { backfillTestTagAssets } from "@/server/test-tag-assets";
import { logActivity } from "@/lib/activity-log";
import {
  mirrorAssetCreate,
  patchAssetInConvex,
  removeAssetFromConvex,
  syncAssetsToConvex,
} from "@/lib/asset-mirror";
import { getSupplierById } from "@/lib/suppliers-read";
import { getModelById, getModelWithCategoryMap, type ModelWithCategory } from "@/lib/models-read";
import { getLocationMap, type ConvexLocation } from "@/lib/locations-read";
import { getPrimaryPhotoMaps } from "@/lib/media-read";
import { type FilterValue } from "@/lib/table-utils";
import {
  getMappedAssetsByOrg,
  filterAssets,
  sortAssets,
  paginate,
} from "@/lib/assets-read";
import { translatePrismaError, UserFacingError } from "@/lib/errors";
import { validateCustomFieldValues } from "@/lib/validations/custom-field";
import { getActiveCustomFieldsForOrg } from "@/lib/custom-fields-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Validate + normalise asset custom-field values against the org's active
 * ASSET custom-field definitions. Throws UserFacingError on a required-field
 * miss or a bad value. Returns the normalised map (unknown keys dropped).
 */
async function resolveAssetCustomFields(
  organizationId: string,
  raw: Record<string, string> | null | undefined,
): Promise<Record<string, string>> {
  // Custom field definitions are Convex-only (custom-fields.ts writes Convex);
  // the Prisma table is frozen, so read the active ASSET defs from Convex.
  const defs = await getActiveCustomFieldsForOrg(organizationId, "ASSET");
  if (defs.length === 0) return {};
  try {
    return validateCustomFieldValues(defs, raw);
  } catch (e) {
    throw new UserFacingError({
      code: "CUSTOM_FIELD_INVALID",
      title: "Custom field problem",
      message: e instanceof Error ? e.message : "A custom field value is invalid.",
    });
  }
}

// model (+ nested equipment category) + location live in Convex (dual-written) —
// attached from the maps, not Prisma joins. Sorts/filters on model.name /
// location.name / model.categoryId stay on the always-fresh Prisma mirror.
export type AssetWithRelations = Prisma.AssetGetPayload<{ include: Record<string, never> }> & {
  model: ModelWithCategory | null;
  location: ConvexLocation | null;
};

export async function getAssets(params?: {
  search?: string;
  categoryId?: string;
  status?: string;
  condition?: string;
  locationId?: string;
  modelId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, FilterValue>;
}) {
  const { organizationId } = await getOrgContext();
  const {
    search, categoryId, status, condition, locationId, modelId,
    isActive = true, page = 1, pageSize = 25,
    sortBy = "assetTag", sortOrder = "asc",
    filters,
  } = params || {};

  // Extract the DataTable enum `in` filters (status/condition/locationId/
  // categoryId) and the tags hasSome filter from the raw filter map.
  const asArr = (v: FilterValue | undefined): string[] | undefined =>
    Array.isArray(v) && v.length > 0 ? (v as string[]) : undefined;

  // Asset rows + model/location maps all come from Convex (dual-written). The
  // org's full row set is fetched then filtered/sorted/paginated in JS,
  // replicating the old Prisma where/orderBy. See src/lib/assets-read.ts.
  const [allAssets, modelMap, locationMap] = await Promise.all([
    getMappedAssetsByOrg(organizationId),
    getModelWithCategoryMap(organizationId),
    getLocationMap(organizationId),
  ]);
  const modelNameFor = (id: string) => modelMap.get(id)?.name;
  const categoryFor = (id: string) => modelMap.get(id)?.categoryId;
  const locationNameFor = (id: string | null) => (id ? locationMap.get(id)?.name : null);

  const filtered = filterAssets(
    allAssets,
    {
      search, categoryId, status, condition, locationId, modelId, isActive,
      statusIn: asArr(filters?.status),
      conditionIn: asArr(filters?.condition),
      locationIdIn: asArr(filters?.locationId),
      categoryIdIn: asArr(filters?.categoryId),
      tagsHasSome: asArr(filters?.tags),
    },
    modelNameFor,
    categoryFor,
  );
  const total = filtered.length;
  const sorted = sortAssets(filtered, sortBy, sortOrder, modelNameFor, locationNameFor);
  const pageRows = paginate(sorted, page, pageSize);

  const withRelations = pageRows.map((a) => ({
    ...a,
    model: a.modelId ? modelMap.get(a.modelId) ?? null : null,
    location: a.locationId ? locationMap.get(a.locationId) ?? null : null,
  }));

  return serialize({ assets: withRelations, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function getAsset(id: string) {
  const { organizationId } = await getOrgContext();
  const asset = await prisma.asset.findUnique({
    where: { id, organizationId },
    include: {
      media: {
        include: { file: true },
        orderBy: { sortOrder: "asc" },
      },
      maintenanceLinks: {
        include: { maintenanceRecord: true },
        orderBy: { maintenanceRecord: { createdAt: "desc" } },
        take: 20,
      },
      scanLogs: {
        orderBy: { scannedAt: "desc" },
        take: 20,
        include: { scannedBy: true, project: true },
      },
      lineItems: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { project: true },
      },
      testTagAsset: {
        select: {
          id: true,
          testTagId: true,
          status: true,
          lastTestDate: true,
          nextDueDate: true,
          testIntervalMonths: true,
        },
      },
      // Child assets / accessories
      parentAsset: { select: { id: true, assetTag: true, customName: true } },
      childAssets: { orderBy: { assetTag: "asc" } },
      childBulkItems: {
        include: { bulkAsset: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!asset) return serialize(asset);

  // Model (+ category) + supplier live in Convex — attach instead of Prisma joins.
  // Model media stays a Prisma read (gallery terminus); bulkAccessories now from Convex.
  const modelMediaPromise: Promise<Prisma.ModelMediaGetPayload<{ include: { file: true } }>[]> = asset.modelId
    ? prisma.modelMedia.findMany({
        where: { modelId: asset.modelId },
        include: { file: true },
        orderBy: { sortOrder: "asc" },
      })
    : Promise.resolve([]);

  const convex = await getConvexClient();
  const modelBulkAccessoriesPromise = asset.modelId
    ? convex.query(api.modelBulkAccessories.listByModelId, {
        modelId: asset.modelId,
        organizationId,
      })
    : Promise.resolve([]);

  const [modelMap, modelMediaRows, supplier] = await Promise.all([
    getModelWithCategoryMap(organizationId),
    modelMediaPromise,
    asset.supplierId ? getSupplierById(asset.supplierId) : null,
  ]);
  const modelBulkAccessoriesRaw = await modelBulkAccessoriesPromise;

  const assetModel = asset.modelId ? modelMap.get(asset.modelId) ?? null : null;

  const childAssetsWithModel = asset.childAssets.map((child) => ({
    ...child,
    model: child.modelId ? modelMap.get(child.modelId) ?? null : null,
  }));

  const childBulkItemsWithModel = asset.childBulkItems.map((item) => ({
    ...item,
    bulkAsset: {
      ...item.bulkAsset,
      model: item.bulkAsset.modelId ? modelMap.get(item.bulkAsset.modelId) ?? null : null,
    },
  }));

  const bulkAccessoriesWithModel = modelBulkAccessoriesRaw.map((ba) => ({
    id: ba.id,
    organizationId: ba.organizationId,
    modelId: ba.modelId,
    bulkAssetId: ba.bulkAssetId,
    quantity: ba.quantity,
    sortOrder: ba.sortOrder ?? null,
    notes: ba.notes ?? null,
    addedAt: ba.addedAt ? new Date(ba.addedAt) : null,
    addedById: ba.addedById,
    bulkAsset: {
      id: ba.bulkAssetId,
      assetTag: ba.bulkAssetAssetTag ?? "",
      modelId: ba.bulkAssetModelId ?? null,
      model: ba.bulkAssetModelId ? modelMap.get(ba.bulkAssetModelId) ?? null : null,
    },
  }));

  // Location FK was dropped (Phase B); attach `location` from the Convex mirror.
  const location = asset.locationId
    ? (await getLocationMap(organizationId)).get(asset.locationId) ?? null
    : null;

  return serialize({
    ...asset,
    location,
    model: assetModel
      ? { ...assetModel, media: modelMediaRows, bulkAccessories: bulkAccessoriesWithModel }
      : null,
    childAssets: childAssetsWithModel,
    childBulkItems: childBulkItemsWithModel,
    supplier,
  });
}

/**
 * Primary photos for the reactive registry table. Both maps now come off the
 * Convex `assetMedia` / `modelMedia` + `fileUploads` mirror via getPrimaryPhotoMap
 * (Phase 6 decommission — those tables are now dual-written). Returns two maps:
 * per-assetId (the asset's own primary photo) and per-modelId (the model's
 * primary photo, used as a fallback). The reactive table subscribes to
 * assets/bulkAssets via Convex and merges these (non-reactive) photos in:
 * photo = assetPhotos[a.id] ?? modelPhotos[a.modelId]. Model name / category /
 * location resolve from the Convex models/categories/locations the table already
 * loads.
 */
export async function getAssetRegistryPhotos(): Promise<{
  assetPhotos: Record<string, { url: string | null; thumbnailUrl: string | null }>;
  modelPhotos: Record<string, { url: string | null; thumbnailUrl: string | null }>;
}> {
  const { organizationId } = await getOrgContext();
  // One shared fileUploads collect for both maps (asset + model).
  const maps = await getPrimaryPhotoMaps(["asset", "model"], organizationId);
  return serialize({ assetPhotos: maps.asset, modelPhotos: maps.model });
}

export async function createAsset(data: AssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("asset", "create");
  const parsed = assetSchema.parse(data);

  // Validate custom fields against org definitions before persisting.
  const customFieldValues = await resolveAssetCustomFields(
    organizationId,
    parsed.customFieldValues,
  );

  // Model lives in Convex — fetch for T&T requirements check.
  const model = await getModelById(parsed.modelId);

  try {
    const result = await prisma.asset.create({
      data: {
        organizationId,
        modelId: parsed.modelId,
        assetTag: parsed.assetTag,
        serialNumber: parsed.serialNumber,
        customName: parsed.customName,
        status: parsed.status,
        condition: parsed.condition,
        purchaseDate: parsed.purchaseDate,
        purchasePrice: parsed.purchasePrice,
        purchaseSupplier: parsed.purchaseSupplier,
        supplierId: parsed.supplierId || null,
        purchaseOrderNumber: parsed.purchaseOrderNumber || null,
        warrantyExpiry: parsed.warrantyExpiry,
        notes: parsed.notes,
        locationId: parsed.locationId || null,
        customFieldValues,
        barcode: parsed.barcode || parsed.assetTag,
        qrCode: parsed.assetTag,
        images: parsed.images,
        isActive: parsed.isActive,
        tags: parsed.tags,
      },
    });
    // Advance the counter now that the asset is actually created
    await reserveAssetTags(1);
    await mirrorAssetCreate(result);

    // Auto-register in T&T registry if model requires it (Convex-only write).
    if (model?.requiresTestAndTag) {
      const orgTT = await getOrgTestTagSettings();
      const intervalMonths = model.testAndTagIntervalDays
        ? Math.max(1, Math.round(model.testAndTagIntervalDays / 30))
        : (orgTT.defaultIntervalMonths || 3);
      const convexForTT = await getConvexClient();
      const ttNow = Date.now();
      await convexForTT.mutation(api.testTagAssets.createIfMissing, {
        id: createId(),
        organizationId,
        testTagId: parsed.assetTag,
        description: `${model.manufacturer ? model.manufacturer + " " : ""}${model.name} (${parsed.assetTag})`,
        equipmentClass: (model.defaultEquipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
        applianceType: (model.defaultApplianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
        ...(model.manufacturer && { make: model.manufacturer }),
        ...(model.modelNumber && { modelName: model.modelNumber }),
        ...(parsed.serialNumber && { serialNumber: parsed.serialNumber }),
        testIntervalMonths: intervalMonths,
        status: "NOT_YET_TESTED",
        assetId: result.id,
        isActive: true,
        createdAt: ttNow,
        updatedAt: ttNow,
      });
    }

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "asset",
      entityId: result.id,
      entityName: result.assetTag,
      summary: `Created asset ${result.assetTag}`,
      details: { created: { assetTag: result.assetTag, modelId: parsed.modelId } },
      assetId: result.id,
    });

    return serialize(result);
  } catch (e: unknown) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
}

export async function createAssets(
  data: AssetFormValues,
  assets: { tag: string; serialNumber?: string }[],
) {
  const { organizationId, userId, userName } = await requirePermission("asset", "create");
  const parsed = assetSchema.parse(data);

  // All assets in a bulk create share the same form data → one validation.
  const customFieldValues = await resolveAssetCustomFields(
    organizationId,
    parsed.customFieldValues,
  );

  // Model lives in Convex — fetch for T&T requirements check.
  const model = await getModelById(parsed.modelId);

  let results;
  try {
    results = await prisma.$transaction(
      assets.map(({ tag, serialNumber }) =>
        prisma.asset.create({
          data: {
            organizationId,
            modelId: parsed.modelId,
            assetTag: tag,
            serialNumber: serialNumber || parsed.serialNumber,
            customName: parsed.customName,
            status: parsed.status,
            condition: parsed.condition,
            purchaseDate: parsed.purchaseDate,
            purchasePrice: parsed.purchasePrice,
            purchaseSupplier: parsed.purchaseSupplier,
            supplierId: parsed.supplierId || null,
            warrantyExpiry: parsed.warrantyExpiry,
            notes: parsed.notes,
            locationId: parsed.locationId || null,
            customFieldValues,
            barcode: parsed.barcode || tag,
            qrCode: tag,
            images: parsed.images,
            isActive: parsed.isActive,
            tags: parsed.tags,
          },
        })
      )
    );
  } catch (e: unknown) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }

  // Advance the counter now that assets are actually created
  await reserveAssetTags(assets.length);
  for (const result of results) await mirrorAssetCreate(result);

  // Auto-register in T&T registry if model requires it (Convex-only write).
  if (model?.requiresTestAndTag) {
    const orgTT = await getOrgTestTagSettings();
    const intervalMonths = model.testAndTagIntervalDays
      ? Math.max(1, Math.round(model.testAndTagIntervalDays / 30))
      : (orgTT.defaultIntervalMonths || 3);
    const convexForTT = await getConvexClient();
    const ttNow = Date.now();
    for (const asset of results) {
      await convexForTT.mutation(api.testTagAssets.createIfMissing, {
        id: createId(),
        organizationId,
        testTagId: asset.assetTag,
        description: `${model.manufacturer ? model.manufacturer + " " : ""}${model.name} (${asset.assetTag})`,
        equipmentClass: (model.defaultEquipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
        applianceType: (model.defaultApplianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
        ...(model.manufacturer && { make: model.manufacturer }),
        ...(model.modelNumber && { modelName: model.modelNumber }),
        ...(asset.serialNumber && { serialNumber: asset.serialNumber }),
        testIntervalMonths: intervalMonths,
        status: "NOT_YET_TESTED",
        assetId: asset.id,
        isActive: true,
        createdAt: ttNow,
        updatedAt: ttNow,
      });
    }
  }

  for (const result of results) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "asset",
      entityId: result.id,
      entityName: result.assetTag,
      summary: `Created asset ${result.assetTag}`,
      details: { created: { assetTag: result.assetTag, modelId: parsed.modelId } },
      assetId: result.id,
    });
  }

  return serialize(results);
}

export async function updateAsset(id: string, data: AssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("asset", "update");
  const parsed = assetSchema.parse(data);

  const customFieldValues = await resolveAssetCustomFields(
    organizationId,
    parsed.customFieldValues,
  );

  const before = await prisma.asset.findUnique({ where: { id, organizationId } });

  let updated;
  try {
    updated = await prisma.asset.update({
      where: { id, organizationId },
      data: {
        modelId: parsed.modelId,
        assetTag: parsed.assetTag,
        serialNumber: parsed.serialNumber,
        customName: parsed.customName,
        status: parsed.status,
        condition: parsed.condition,
        purchaseDate: parsed.purchaseDate,
        purchasePrice: parsed.purchasePrice,
        purchaseSupplier: parsed.purchaseSupplier,
        supplierId: parsed.supplierId || null,
        warrantyExpiry: parsed.warrantyExpiry,
        notes: parsed.notes,
        locationId: parsed.locationId || null,
        customFieldValues,
        barcode: parsed.barcode || parsed.assetTag,
        images: parsed.images,
        isActive: parsed.isActive,
        tags: parsed.tags,
      },
    });
  } catch (e: unknown) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
  await patchAssetInConvex(updated.id, updated);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: updated.id,
    entityName: updated.assetTag,
    summary: `Updated asset ${updated.assetTag}`,
    assetId: updated.id,
  });

  // Register in T&T if model requires it and not already registered
  // Model lives in Convex — fetch for T&T requirements check.
  const model = await getModelById(parsed.modelId);
  if (model?.requiresTestAndTag) {
    await backfillTestTagAssets();
  }

  return serialize(updated);
}

export async function bulkUpdateAssets(
  ids: string[],
  data: {
    status?: string;
    condition?: string;
    locationId?: string | null;
  },
) {
  const { organizationId } = await requirePermission("asset", "update");
  if (ids.length === 0) {
    throw new UserFacingError({
      code: "NO_SELECTION",
      title: "Nothing selected",
      message: "Select at least one asset before applying a bulk change.",
    });
  }

  const updateData: Record<string, unknown> = {};
  if (data.status) updateData.status = data.status;
  if (data.condition) updateData.condition = data.condition;
  if (data.locationId !== undefined) updateData.locationId = data.locationId || null;

  if (Object.keys(updateData).length === 0) {
    throw new UserFacingError({
      code: "NO_CHANGES",
      title: "No changes specified",
      message: "Pick a field to change (status, condition, or location) before applying.",
    });
  }

  const result = await prisma.asset.updateMany({
    where: { id: { in: ids }, organizationId },
    data: updateData,
  });
  await syncAssetsToConvex(ids);

  return { count: result.count };
}

export async function deleteAsset(id: string) {
  const { organizationId, userId, userName } = await requirePermission("asset", "delete");

  const asset = await prisma.asset.findUnique({
    where: { id, organizationId },
    include: {
      _count: { select: { lineItems: true, maintenanceLinks: true, childAssets: true, childBulkItems: true } },
      kitItem: true,
    },
  });
  if (!asset) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Asset not found",
      message: "This asset was deleted or moved. Refresh the page to see the latest state.",
    });
  }

  if (asset._count.lineItems > 0) {
    throw new UserFacingError({
      code: "ASSET_IN_USE",
      title: "Cannot delete",
      message: "This asset is referenced by project line items.",
      hint: "Archive it instead so the history stays intact.",
    });
  }
  if (asset.kitItem) {
    throw new UserFacingError({
      code: "ASSET_IN_KIT",
      title: "Cannot delete",
      message: "This asset is part of a kit.",
      hint: "Remove it from the kit first, then delete.",
    });
  }
  // Deleting a parent would silently orphan/destroy its accessories
  // (serialised children SetNull, bulk-child rows cascade). Block it.
  if (asset._count.childAssets > 0 || asset._count.childBulkItems > 0) {
    throw new UserFacingError({
      code: "ASSET_HAS_ACCESSORIES",
      title: "Cannot delete",
      message: "This asset has accessories attached.",
      hint: "Detach its accessories first, then delete.",
    });
  }

  // Retire linked T&T entry if one exists
  // Retire linked T&T entry if one exists (Convex-only write).
  const convexForTT = await getConvexClient();
  const linkedTTList = await convexForTT.query(api.testTagAssets.listByAssetId, { assetId: id });
  for (const linkedTT of linkedTTList) {
    await convexForTT.mutation(api.testTagAssets.update, {
      id: linkedTT.id,
      patch: { status: "RETIRED", isActive: false, updatedAt: Date.now() },
    });
  }

  await prisma.asset.delete({ where: { id, organizationId } });
  await removeAssetFromConvex(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "asset",
    entityId: id,
    entityName: asset.assetTag,
    summary: `Deleted asset ${asset.assetTag}`,
    details: { deleted: { assetTag: asset.assetTag } },
  });

  return { id };
}

export async function updateAssetNotes(id: string, notes: string) {
  const { organizationId } = await requirePermission("asset", "update");
  const updated = await prisma.asset.update({
    where: { id, organizationId },
    data: { notes: notes || null },
  });
  await patchAssetInConvex(updated.id, updated);
  return serialize(updated);
}

export async function archiveAsset(id: string) {
  const { organizationId } = await requirePermission("asset", "update");

  // Retire linked T&T entries (Convex-only write).
  const convexForTT = await getConvexClient();
  const linkedTTList = await convexForTT.query(api.testTagAssets.listByAssetId, { assetId: id });
  const archiveNow = Date.now();
  for (const tt of linkedTTList) {
    await convexForTT.mutation(api.testTagAssets.update, {
      id: tt.id,
      patch: { status: "RETIRED", isActive: false, updatedAt: archiveNow },
    });
  }

  const updated = await prisma.asset.update({
    where: { id, organizationId },
    data: { isActive: false, status: "RETIRED" },
  });
  await patchAssetInConvex(updated.id, updated);
  return serialize(updated);
}
