"use server";

import { prisma } from "@/lib/prisma";
import { serialize } from "@/lib/serialize";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { modelSchema, type ModelFormValues } from "@/lib/validations/model";
import type { Prisma } from "@/generated/prisma/client";
import { backfillTestTagAssets } from "@/server/test-tag-assets";
import { getOrgTestTagSettings } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";

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
    },
  });
  return serialize(model);
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
      await prisma.testTagAsset.updateMany({
        where: {
          organizationId,
          assetId: { in: assetIds },
          isActive: true,
        },
        data: {
          equipmentClass,
          applianceType,
          testIntervalMonths: intervalMonths,
        },
      });
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

  // Delete all assets and bulk assets under this model
  await Promise.all([
    prisma.asset.deleteMany({ where: { modelId: id, organizationId } }),
    prisma.bulkAsset.deleteMany({ where: { modelId: id, organizationId } }),
  ]);

  const archived = await prisma.model.update({
    where: { id, organizationId },
    data: { isActive: false },
  });

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

  await prisma.$transaction(updates);

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
