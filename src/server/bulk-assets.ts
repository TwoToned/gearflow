"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { bulkAssetSchema, type BulkAssetFormValues } from "@/lib/validations/asset";
import type { Prisma } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { reserveAssetTags } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";

export type BulkAssetWithRelations = Prisma.BulkAssetGetPayload<{
  include: {
    model: { include: { category: true } };
    location: true;
  };
}>;

export async function getBulkAssets(params?: {
  search?: string;
  categoryId?: string;
  status?: string;
  locationId?: string;
  modelId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();
  const {
    search, categoryId, status, locationId, modelId,
    isActive = true, page = 1, pageSize = 25,
    sortBy = "assetTag", sortOrder = "asc",
  } = params || {};

  const where: Prisma.BulkAssetWhereInput = {
    organizationId,
    isActive,
    ...(status && { status: status as Prisma.EnumBulkAssetStatusFilter }),
    ...(locationId && { locationId }),
    ...(modelId && { modelId }),
    ...(categoryId && { model: { categoryId } }),
    ...(search && {
      OR: [
        { assetTag: { contains: search, mode: "insensitive" } },
        { model: { name: { contains: search, mode: "insensitive" } } },
      ],
    }),
  };

  const [bulkAssets, total] = await Promise.all([
    prisma.bulkAsset.findMany({
      where,
      include: {
        model: { include: { category: true } },
        location: true,
      },
      orderBy: sortBy === "model" ? { model: { name: sortOrder } }
        : sortBy === "location" ? { location: { name: sortOrder } }
        : { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bulkAsset.count({ where }),
  ]);

  return serialize({ bulkAssets, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function getBulkAsset(id: string) {
  const { organizationId } = await getOrgContext();
  return serialize(await prisma.bulkAsset.findUnique({
    where: { id, organizationId },
    include: {
      model: { include: { category: true } },
      location: true,
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
      testTagAssets: {
        select: {
          id: true,
          testTagId: true,
          status: true,
          lastTestDate: true,
          nextDueDate: true,
        },
        orderBy: { testTagId: "asc" },
      },
    },
  }));
}

export async function createBulkAsset(data: BulkAssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("bulkAsset", "create");
  const parsed = bulkAssetSchema.parse(data);
  try {
    const result = await prisma.bulkAsset.create({
      data: {
        organizationId,
        modelId: parsed.modelId,
        assetTag: parsed.assetTag,
        totalQuantity: parsed.totalQuantity,
        availableQuantity: parsed.totalQuantity,
        purchasePricePerUnit: parsed.purchasePricePerUnit,
        locationId: parsed.locationId || null,
        status: parsed.status,
        reorderThreshold: parsed.reorderThreshold,
        preferredSupplierId: parsed.preferredSupplierId || null,
        notes: parsed.notes,
        isActive: parsed.isActive,
        tags: parsed.tags,
      },
    });
    await reserveAssetTags(1);

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "bulkAsset",
      entityId: result.id,
      entityName: result.assetTag,
      summary: `Created bulk asset ${result.assetTag}`,
      details: { created: { assetTag: result.assetTag, totalQuantity: parsed.totalQuantity } },
    });

    return serialize(result);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      throw new Error(`Asset tag "${parsed.assetTag}" already exists`);
    }
    throw e;
  }
}

export async function updateBulkAsset(id: string, data: BulkAssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("bulkAsset", "update");
  const parsed = bulkAssetSchema.parse(data);

  const existing = await prisma.bulkAsset.findUnique({ where: { id, organizationId } });
  if (!existing) throw new Error("Bulk asset not found");

  // Adjust available quantity based on total change
  const totalDiff = parsed.totalQuantity - existing.totalQuantity;
  const newAvailable = Math.max(0, existing.availableQuantity + totalDiff);

  const updated = await prisma.bulkAsset.update({
    where: { id, organizationId },
    data: {
      modelId: parsed.modelId,
      assetTag: parsed.assetTag,
      totalQuantity: parsed.totalQuantity,
      availableQuantity: newAvailable,
      purchasePricePerUnit: parsed.purchasePricePerUnit,
      locationId: parsed.locationId || null,
      status: parsed.status,
      reorderThreshold: parsed.reorderThreshold,
      notes: parsed.notes,
      isActive: parsed.isActive,
      tags: parsed.tags,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "bulkAsset",
    entityId: updated.id,
    entityName: updated.assetTag,
    summary: `Updated bulk asset ${updated.assetTag}`,
  });

  return serialize(updated);
}

export async function deleteBulkAsset(id: string) {
  const { organizationId, userId, userName } = await requirePermission("bulkAsset", "delete");

  const asset = await prisma.bulkAsset.findUnique({
    where: { id, organizationId },
    include: {
      _count: { select: { lineItems: true, kitBulkItems: true } },
    },
  });
  if (!asset) throw new Error("Bulk asset not found");

  if (asset._count.lineItems > 0) {
    throw new Error("Cannot delete — this bulk asset is referenced by project line items. Archive it instead.");
  }
  if (asset._count.kitBulkItems > 0) {
    throw new Error("Cannot delete — this bulk asset is part of a kit. Remove it from the kit first.");
  }

  await prisma.bulkAsset.delete({ where: { id, organizationId } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "bulkAsset",
    entityId: id,
    entityName: asset.assetTag,
    summary: `Deleted bulk asset ${asset.assetTag}`,
    details: { deleted: { assetTag: asset.assetTag } },
  });

  return { id };
}

export async function updateBulkAssetNotes(id: string, notes: string) {
  const { organizationId } = await requirePermission("bulkAsset", "update");
  return serialize(await prisma.bulkAsset.update({
    where: { id, organizationId },
    data: { notes: notes || null },
  }));
}

export async function archiveBulkAsset(id: string) {
  const { organizationId } = await requirePermission("bulkAsset", "update");
  return serialize(await prisma.bulkAsset.update({
    where: { id, organizationId },
    data: { isActive: false, status: "RETIRED" },
  }));
}
