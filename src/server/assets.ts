"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import type { Prisma } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { reserveAssetTags, getOrgTestTagSettings } from "@/server/settings";
import { backfillTestTagAssets } from "@/server/test-tag-assets";
import { logActivity } from "@/lib/activity-log";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";
import { translatePrismaError, UserFacingError } from "@/lib/errors";
import { validateCustomFieldValues } from "@/lib/validations/custom-field";

/**
 * Validate + normalise asset custom-field values against the org's active
 * ASSET custom-field definitions. Throws UserFacingError on a required-field
 * miss or a bad value. Returns the normalised map (unknown keys dropped).
 */
async function resolveAssetCustomFields(
  organizationId: string,
  raw: Record<string, string> | null | undefined,
): Promise<Record<string, string>> {
  const defs = await prisma.customFieldDefinition.findMany({
    where: { organizationId, entityType: "ASSET", isActive: true },
    select: { fieldKey: true, label: true, fieldType: true, options: true, required: true },
  });
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

const assetFilterColumns: FilterColumnDef[] = [
  { id: "status", filterType: "enum" },
  { id: "condition", filterType: "enum" },
  { id: "locationId", filterType: "enum" },
  { id: "categoryId", filterType: "enum", filterKey: "model.categoryId" },
  { id: "tags", filterType: "enum" },
];

export type AssetWithRelations = Prisma.AssetGetPayload<{
  include: {
    model: { include: { category: true } };
    location: true;
  };
}>;

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

  // Build filter where from DataTable filters
  const filterWhere = buildFilterWhere(filters, assetFilterColumns);

  // Handle tags filter specially (hasSome)
  let tagsFilter: Prisma.AssetWhereInput | undefined;
  if (filters?.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
    tagsFilter = { tags: { hasSome: filters.tags as string[] } };
    delete (filterWhere as Record<string, unknown>).tags;
  }

  const where: Prisma.AssetWhereInput = {
    organizationId,
    isActive,
    ...(status && { status: status as Prisma.EnumAssetStatusFilter }),
    ...(condition && { condition: condition as Prisma.EnumAssetConditionFilter }),
    ...(locationId && { locationId }),
    ...(modelId && { modelId }),
    ...(categoryId && { model: { categoryId } }),
    ...filterWhere,
    ...tagsFilter,
    ...(search && {
      OR: [
        { assetTag: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        { customName: { contains: search, mode: "insensitive" } },
        { model: { name: { contains: search, mode: "insensitive" } } },
      ],
    }),
  };

  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: {
        model: {
          include: {
            category: true,
            media: {
              where: { type: "PHOTO", isPrimary: true },
              include: { file: true },
              take: 1,
            },
          },
        },
        location: true,
        media: {
          where: { type: "PHOTO", isPrimary: true },
          include: { file: true },
          take: 1,
        },
      },
      orderBy: sortBy === "model" ? { model: { name: sortOrder } }
        : sortBy === "location" ? { location: { name: sortOrder } }
        : { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.asset.count({ where }),
  ]);

  return serialize({ assets, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function getAsset(id: string) {
  const { organizationId } = await getOrgContext();
  return serialize(await prisma.asset.findUnique({
    where: { id, organizationId },
    include: {
      model: {
        include: {
          category: true,
          media: {
            include: { file: true },
            orderBy: { sortOrder: "asc" },
          },
          bulkAccessories: {
            include: { bulkAsset: { include: { model: { select: { name: true } } } } },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
      location: true,
      supplier: true,
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
      childAssets: {
        include: { model: { select: { name: true, manufacturer: true } } },
        orderBy: { assetTag: "asc" },
      },
      childBulkItems: {
        include: { bulkAsset: { include: { model: { select: { name: true } } } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  }));
}

export async function createAsset(data: AssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("asset", "create");
  const parsed = assetSchema.parse(data);

  // Validate custom fields against org definitions before persisting.
  const customFieldValues = await resolveAssetCustomFields(
    organizationId,
    parsed.customFieldValues,
  );

  // Fetch the model to check T&T requirements
  const model = await prisma.model.findUnique({ where: { id: parsed.modelId } });

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

    // Auto-register in T&T registry if model requires it
    if (model?.requiresTestAndTag) {
      const orgTT = await getOrgTestTagSettings();
      const intervalMonths = model.testAndTagIntervalDays
        ? Math.max(1, Math.round(model.testAndTagIntervalDays / 30))
        : (orgTT.defaultIntervalMonths || 3);
      await prisma.testTagAsset.create({
        data: {
          organizationId,
          testTagId: parsed.assetTag,
          description: `${model.manufacturer ? model.manufacturer + " " : ""}${model.name} (${parsed.assetTag})`,
          equipmentClass: model.defaultEquipmentClass || "CLASS_I",
          applianceType: model.defaultApplianceType || "APPLIANCE",
          make: model.manufacturer || null,
          modelName: model.modelNumber || null,
          serialNumber: parsed.serialNumber || null,
          testIntervalMonths: intervalMonths,
          status: "NOT_YET_TESTED",
          assetId: result.id,
        },
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

  const model = await prisma.model.findUnique({ where: { id: parsed.modelId } });

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

  // Auto-register in T&T registry if model requires it
  if (model?.requiresTestAndTag) {
    const orgTT = await getOrgTestTagSettings();
    const intervalMonths = model.testAndTagIntervalDays
      ? Math.max(1, Math.round(model.testAndTagIntervalDays / 30))
      : (orgTT.defaultIntervalMonths || 3);
    await prisma.$transaction(
      results.map((asset) =>
        prisma.testTagAsset.create({
          data: {
            organizationId,
            testTagId: asset.assetTag,
            description: `${model.manufacturer ? model.manufacturer + " " : ""}${model.name} (${asset.assetTag})`,
            equipmentClass: model.defaultEquipmentClass || "CLASS_I",
            applianceType: model.defaultApplianceType || "APPLIANCE",
            make: model.manufacturer || null,
            modelName: model.modelNumber || null,
            serialNumber: asset.serialNumber || null,
            testIntervalMonths: intervalMonths,
            status: "NOT_YET_TESTED",
            assetId: asset.id,
          },
        })
      )
    );
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
  const model = await prisma.model.findUnique({ where: { id: parsed.modelId } });
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
  const linkedTT = await prisma.testTagAsset.findFirst({
    where: { assetId: id, organizationId },
  });
  if (linkedTT) {
    await prisma.testTagAsset.update({
      where: { id: linkedTT.id },
      data: { status: "RETIRED", isActive: false, assetId: null },
    });
  }

  await prisma.asset.delete({ where: { id, organizationId } });

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
  return serialize(await prisma.asset.update({
    where: { id, organizationId },
    data: { notes: notes || null },
  }));
}

export async function archiveAsset(id: string) {
  const { organizationId } = await requirePermission("asset", "update");

  // Retire linked T&T entry if one exists
  await prisma.testTagAsset.updateMany({
    where: { assetId: id, organizationId },
    data: { status: "RETIRED", isActive: false },
  });

  return serialize(await prisma.asset.update({
    where: { id, organizationId },
    data: { isActive: false, status: "RETIRED" },
  }));
}
