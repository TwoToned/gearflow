"use server";

import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { removeAssetFromConvex, removeBulkAssetFromConvex } from "@/lib/asset-mirror";
import { getPrimaryPhotoMap } from "@/lib/media-read";
import { getModelMap } from "@/lib/models-read";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { api } from "../../convex/_generated/api";
import { serialize } from "@/lib/serialize";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { modelSchema, type ModelFormValues } from "@/lib/validations/model";
import type { Prisma } from "@/generated/prisma/client";
import { backfillTestTagAssets } from "@/server/test-tag-assets";
import { patchTestTagAssetInConvex } from "@/lib/test-tag-mirror";
import { getOrgTestTagSettings } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";

// Models are DUAL-WRITTEN: every create/update/archive writes the Prisma `model`
// row (the durable FK anchor — asset/bulk_asset hold a required + Restrict FK;
// model_media/model_check_item/supplier_model_rate/model_bulk_accessory hold a
// required + Cascade FK; project_line_item/supplier_order_item/group_template_item/
// sub_hire_item hold nullable FKs) AND the Convex `models` doc (the reactive read
// source). Prisma is written first; the Convex payload is derived from the written
// row via toConvexDoc so the two can't drift. Cross-domain `model.*` joins stay on
// the always-fresh Prisma mirror and migrate at decommission. See FEATUREDOCS/54.

/** Mirror a freshly written Prisma model row into Convex (create). */
async function mirrorModelToConvex(row: Record<string, unknown>) {
  await (await getConvexClient()).mutation(
    api.models.createIfMissing,
    toConvexDoc(row) as FunctionArgs<typeof api.models.createIfMissing>,
  );
}

/** Mirror an updated Prisma model row into Convex (patch, id stripped). */
async function patchModelInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...patch } = toConvexDoc(row);
  await (await getConvexClient()).mutation(api.models.update, {
    id,
    patch: patch as FunctionArgs<typeof api.models.update>["patch"],
  });
}

const modelFilterColumns: FilterColumnDef[] = [
  { id: "categoryId", filterType: "enum" },
  { id: "assetType", filterType: "enum" },
];

export type ModelWithRelations = Prisma.ModelGetPayload<{
  include: {
    category: true;
    _count: { select: { assets: true; bulkAssets: true } };
  };
}>;

export async function getModels(params?: {
  search?: string;
  categoryId?: string;
  assetType?: "SERIALIZED" | "BULK";
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, FilterValue>;
}) {
  const { organizationId } = await getOrgContext();
  const { search, categoryId, assetType, isActive = true, page = 1, pageSize = 25, sortBy = "name", sortOrder = "asc", filters } = params || {};

  const filterWhere = buildFilterWhere(filters, modelFilterColumns);

  const where: Prisma.ModelWhereInput = {
    organizationId,
    isActive,
    ...(categoryId && { categoryId }),
    ...(assetType && { assetType }),
    ...filterWhere,
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
        { modelNumber: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [models, total] = await Promise.all([
    prisma.model.findMany({
      where,
      include: {
        category: true,
        _count: { select: { assets: true, bulkAssets: true } },
        media: {
          where: { type: "PHOTO", isPrimary: true },
          include: { file: true },
          take: 1,
        },
      },
      orderBy: sortBy === "category" ? { category: { name: sortOrder } }
        : { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.model.count({ where }),
  ]);

  return serialize({ models, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

/**
 * Per-model asset/bulk-asset counts + primary photo (modelId -> meta).
 * Cross-domain: assets + bulk assets still live in Prisma (counts come off the
 * fresh mirror); the primary photo comes off the Convex `modelMedia` +
 * `fileUploads` mirror via getPrimaryPhotoMap (Phase 6 decommission — model_media
 * is now dual-written). Used by the reactive model table, which subscribes to the
 * model list via Convex and merges these (non-reactive) values in.
 */
export async function getModelCounts(): Promise<
  Record<string, { assets: number; bulkAssets: number; media: { url: string | null; thumbnailUrl: string | null } | null }>
> {
  const { organizationId } = await getOrgContext();
  const [allAssets, allBulkAssets, photoMap] = await Promise.all([
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
    getPrimaryPhotoMap("model", organizationId),
  ]);
  const out: Record<string, { assets: number; bulkAssets: number; media: { url: string | null; thumbnailUrl: string | null } | null }> = {};
  const ensure = (id: string) => (out[id] ??= { assets: 0, bulkAssets: 0, media: null });
  for (const a of allAssets) if (a.isActive !== false) ensure(a.modelId).assets++;
  for (const b of allBulkAssets) if (b.isActive !== false) ensure(b.modelId).bulkAssets++;
  for (const [modelId, meta] of Object.entries(photoMap)) ensure(modelId).media = meta;
  return serialize(out);
}

export async function getModel(id: string) {
  const { organizationId } = await getOrgContext();
  const model = await prisma.model.findUnique({
    where: { id, organizationId },
    include: {
      category: true,
      assets: {
        where: { isActive: true },
        include: { location: true },
        orderBy: { assetTag: "asc" },
      },
      bulkAssets: {
        where: { isActive: true },
        include: { location: true },
        orderBy: { assetTag: "asc" },
      },
      media: {
        include: { file: true },
        orderBy: { sortOrder: "asc" },
      },
      bulkAccessories: {
        include: { bulkAsset: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!model) return serialize(null);
  const modelMap = await getModelMap(organizationId);
  const enriched = {
    ...model,
    bulkAccessories: model.bulkAccessories.map((ba) => ({
      ...ba,
      bulkAsset: {
        ...ba.bulkAsset,
        model: ba.bulkAsset.modelId ? modelMap.get(ba.bulkAsset.modelId) ?? null : null,
      },
    })),
  };
  return serialize(enriched);
}

export async function createModel(data: ModelFormValues) {
  const { organizationId, userId, userName } = await requirePermission("model", "create");
  const parsed = modelSchema.parse(data);
  const model = await prisma.model.create({
    data: {
      organizationId,
      name: parsed.name,
      manufacturer: parsed.manufacturer,
      modelNumber: parsed.modelNumber,
      sku: parsed.sku || null,
      categoryId: parsed.categoryId || null,
      description: parsed.description,
      image: parsed.image,
      images: parsed.images,
      manuals: parsed.manuals,
      specifications: parsed.specifications ?? undefined,
      customFields: parsed.customFields ?? undefined,
      defaultRentalPrice: parsed.dailyRate ?? parsed.defaultRentalPrice,
      dailyRate: parsed.dailyRate,
      weeklyRate: parsed.weeklyRate,
      monthlyRate: parsed.monthlyRate,
      defaultPurchasePrice: parsed.defaultPurchasePrice,
      replacementCost: parsed.replacementCost,
      weight: parsed.weight,
      powerDraw: parsed.powerDraw,
      requiresTestAndTag: parsed.requiresTestAndTag,
      testAndTagIntervalDays: parsed.requiresTestAndTag ? parsed.testAndTagIntervalDays : null,
      defaultTestProfileId: parsed.requiresTestAndTag ? (parsed.defaultTestProfileId || null) : null,
      defaultEquipmentClass: parsed.requiresTestAndTag ? (parsed.defaultEquipmentClass || "CLASS_I") : null,
      defaultApplianceType: parsed.requiresTestAndTag ? (parsed.defaultApplianceType || "APPLIANCE") : null,
      maintenanceIntervalDays: parsed.maintenanceIntervalDays,
      assetType: parsed.assetType,
      barcodeLabelTemplate: parsed.barcodeLabelTemplate,
      isActive: parsed.isActive,
      tags: parsed.tags,
    },
  });
  await mirrorModelToConvex(model);

  if (parsed.requiresTestAndTag) {
    await backfillTestTagAssets();
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "model",
    entityId: model.id,
    entityName: model.name,
    summary: `Created model ${model.name}`,
    details: { created: { name: model.name, manufacturer: model.manufacturer } },
  });

  return serialize(model);
}

export async function updateModel(id: string, data: ModelFormValues) {
  const { organizationId, userId, userName } = await requirePermission("model", "update");
  const parsed = modelSchema.parse(data);
  const model = await prisma.model.update({
    where: { id, organizationId },
    data: {
      name: parsed.name,
      manufacturer: parsed.manufacturer,
      modelNumber: parsed.modelNumber,
      sku: parsed.sku || null,
      categoryId: parsed.categoryId || null,
      description: parsed.description,
      image: parsed.image,
      images: parsed.images,
      manuals: parsed.manuals,
      specifications: parsed.specifications ?? undefined,
      customFields: parsed.customFields ?? undefined,
      defaultRentalPrice: parsed.dailyRate ?? parsed.defaultRentalPrice,
      dailyRate: parsed.dailyRate,
      weeklyRate: parsed.weeklyRate,
      monthlyRate: parsed.monthlyRate,
      defaultPurchasePrice: parsed.defaultPurchasePrice,
      replacementCost: parsed.replacementCost,
      weight: parsed.weight,
      powerDraw: parsed.powerDraw,
      requiresTestAndTag: parsed.requiresTestAndTag,
      testAndTagIntervalDays: parsed.requiresTestAndTag ? parsed.testAndTagIntervalDays : null,
      defaultTestProfileId: parsed.requiresTestAndTag ? (parsed.defaultTestProfileId || null) : null,
      defaultEquipmentClass: parsed.requiresTestAndTag ? (parsed.defaultEquipmentClass || "CLASS_I") : null,
      defaultApplianceType: parsed.requiresTestAndTag ? (parsed.defaultApplianceType || "APPLIANCE") : null,
      maintenanceIntervalDays: parsed.maintenanceIntervalDays,
      assetType: parsed.assetType,
      barcodeLabelTemplate: parsed.barcodeLabelTemplate,
      isActive: parsed.isActive,
      tags: parsed.tags,
    },
  });
  await patchModelInConvex(id, model);

  if (parsed.requiresTestAndTag) {
    await backfillTestTagAssets();

    // Propagate updated T&T defaults to all active linked TestTagAssets for this model's assets
    const orgTT = await getOrgTestTagSettings();
    const equipmentClass = parsed.defaultEquipmentClass || "CLASS_I";
    const applianceType = parsed.defaultApplianceType || "APPLIANCE";
    const intervalMonths = parsed.testAndTagIntervalDays
      ? Math.max(1, Math.round(parsed.testAndTagIntervalDays / 30))
      : (orgTT.defaultIntervalMonths || 3);

    const assetIds = (await prisma.asset.findMany({
      where: { modelId: id, organizationId, isActive: true },
      select: { id: true },
    })).map((a) => a.id);

    if (assetIds.length > 0) {
      const ttWhere = {
        organizationId,
        assetId: { in: assetIds },
        isActive: true,
      };
      await prisma.testTagAsset.updateMany({
        where: ttWhere,
        data: {
          equipmentClass,
          applianceType,
          testIntervalMonths: intervalMonths,
        },
      });
      // Mirror the updated T&T assets to Convex after the updateMany commits.
      const updatedTT = await prisma.testTagAsset.findMany({ where: ttWhere });
      for (const tt of updatedTT) {
        await patchTestTagAssetInConvex(tt.id, tt as unknown as Record<string, unknown>);
      }
    }
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: model.id,
    entityName: model.name,
    summary: `Updated model ${model.name}`,
  });

  return serialize(model);
}

export async function archiveModel(id: string) {
  const { organizationId, userId, userName } = await requirePermission("model", "delete");

  // Delete all assets and bulk assets under this model — capture their ids first
  // so we can mirror the removals to Convex (both are dual-written).
  const [assetsToRemove, bulkToRemove] = await Promise.all([
    prisma.asset.findMany({ where: { modelId: id, organizationId }, select: { id: true } }),
    prisma.bulkAsset.findMany({ where: { modelId: id, organizationId }, select: { id: true } }),
  ]);
  await Promise.all([
    prisma.asset.deleteMany({ where: { modelId: id, organizationId } }),
    prisma.bulkAsset.deleteMany({ where: { modelId: id, organizationId } }),
  ]);
  for (const a of assetsToRemove) await removeAssetFromConvex(a.id);
  for (const b of bulkToRemove) await removeBulkAssetFromConvex(b.id);

  const archived = await prisma.model.update({
    where: { id, organizationId },
    data: { isActive: false },
  });
  await patchModelInConvex(id, archived);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "model",
    entityId: id,
    entityName: archived.name,
    summary: `Archived model ${archived.name}`,
  });

  return serialize(archived);
}

export async function bulkUpdateRates(
  modelIds: string[],
  rateType: "dailyRate" | "weeklyRate" | "monthlyRate",
  operation: "set" | "multiply" | "increase_percent",
  value: number
) {
  const { organizationId, userId, userName } = await requirePermission("model", "update");

  if (modelIds.length === 0) throw new Error("No models selected");
  if (operation === "set" && value < 0) throw new Error("Rate cannot be negative");
  if (operation === "multiply" && value <= 0) throw new Error("Multiplier must be positive");

  const models = await prisma.model.findMany({
    where: { id: { in: modelIds }, organizationId },
    select: { id: true, name: true, dailyRate: true, weeklyRate: true, monthlyRate: true },
  });

  const updates = models.map((model) => {
    const current = Number(model[rateType] ?? 0);
    let newRate: number;

    switch (operation) {
      case "set":
        newRate = value;
        break;
      case "multiply":
        newRate = current * value;
        break;
      case "increase_percent":
        newRate = current * (1 + value / 100);
        break;
    }

    newRate = Math.round(newRate * 100) / 100;

    const updateData: Prisma.ModelUpdateInput = { [rateType]: newRate };
    // Auto-sync defaultRentalPrice when dailyRate changes
    if (rateType === "dailyRate") {
      updateData.defaultRentalPrice = newRate;
    }

    return prisma.model.update({
      where: { id: model.id, organizationId },
      data: updateData,
    });
  });

  const updatedRows = await prisma.$transaction(updates);
  // Mirror each rate change into Convex (the reactive read source).
  for (const row of updatedRows) {
    await patchModelInConvex(row.id, row);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: modelIds[0],
    entityName: `${models.length} models`,
    summary: `Bulk updated ${rateType} on ${models.length} model(s): ${operation} ${value}`,
  });

  return serialize({ count: models.length });
}
