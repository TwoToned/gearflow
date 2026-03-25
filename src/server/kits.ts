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
import type { Prisma } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { reserveAssetTags } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";
import { getCaseCategoryIds } from "@/server/categories";

const kitFilterColumns: FilterColumnDef[] = [
  { id: "status", filterType: "enum" },
  { id: "condition", filterType: "enum" },
  { id: "locationId", filterType: "enum" },
  { id: "categoryId", filterType: "enum" },
  { id: "tags", filterType: "enum" },
];

// ---------------------------------------------------------------------------
// getKits – paginated list with optional filters
// ---------------------------------------------------------------------------
export async function getKits(params?: {
  search?: string;
  status?: string;
  categoryId?: string;
  locationId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, FilterValue>;
}) {
  const { organizationId } = await getOrgContext();
  const {
    search,
    status,
    categoryId,
    locationId,
    isActive = true,
    page = 1,
    pageSize = 25,
    sortBy = "assetTag",
    sortOrder = "asc",
    filters,
  } = params || {};

  const filterWhere = buildFilterWhere(filters, kitFilterColumns);

  // Handle tags filter specially (hasSome)
  let tagsFilter: Prisma.KitWhereInput | undefined;
  if (filters?.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
    tagsFilter = { tags: { hasSome: filters.tags as string[] } };
    delete (filterWhere as Record<string, unknown>).tags;
  }

  const where: Prisma.KitWhereInput = {
    organizationId,
    isActive,
    isPrep: false, // Exclude prep-kits from the kits list
    ...(status && { status: status as Prisma.EnumKitStatusFilter }),
    ...(categoryId && { categoryId }),
    ...(locationId && { locationId }),
    ...filterWhere,
    ...tagsFilter,
    ...(search && {
      OR: [
        { assetTag: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [kits, total] = await Promise.all([
    prisma.kit.findMany({
      where,
      include: {
        category: { select: { name: true } },
        location: { select: { name: true } },
        _count: { select: { serializedItems: true, bulkItems: true } },
        media: {
          where: { type: "PHOTO", isPrimary: true },
          include: { file: true },
          take: 1,
        },
      },
      orderBy: sortBy === "category" ? { category: { name: sortOrder } }
        : sortBy === "location" ? { location: { name: sortOrder } }
        : { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.kit.count({ where }),
  ]);

  return serialize({
    kits,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

// ---------------------------------------------------------------------------
// getKit – single kit with all relations
// ---------------------------------------------------------------------------
export async function getKit(id: string) {
  const { organizationId } = await getOrgContext();

  return serialize(
    await prisma.kit.findUnique({
      where: { id, organizationId },
      include: {
        serializedItems: {
          include: { asset: { include: { model: true } } },
        },
        bulkItems: {
          include: { bulkAsset: { include: { model: true } } },
        },
        category: true,
        location: true,
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
    }),
  );
}

// ---------------------------------------------------------------------------
// createKit
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// updateKit
// ---------------------------------------------------------------------------
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
  return serialize(await prisma.kit.update({
    where: { id, organizationId },
    data: { notes: notes || null },
  }));
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
// addSerializedItemToKit
// ---------------------------------------------------------------------------
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

  return serialize(
    await prisma.$transaction(async (tx) => {
      const item = await tx.kitSerializedItem.create({
        data: {
          organizationId,
          kitId,
          assetId: parsed.assetId,
          position: parsed.position,
          notes: parsed.notes,
          addedById: userId,
        },
        include: { asset: { include: { model: true } } },
      });

      await tx.asset.update({
        where: { id: parsed.assetId },
        data: { kitId, locationId: kit.locationId },
      });

      return item;
    }),
  );
}

// ---------------------------------------------------------------------------
// addSerializedItemsToKit – batch add multiple serialized assets
// ---------------------------------------------------------------------------
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
  }

  if (assets.length !== assetIds.length) {
    throw new Error("One or more assets were not found");
  }

  return serialize(
    await prisma.$transaction(async (tx) => {
      const created = [];
      for (const item of items) {
        const record = await tx.kitSerializedItem.create({
          data: {
            organizationId,
            kitId,
            assetId: item.assetId,
            position: item.position,
            addedById: userId,
          },
          include: { asset: { include: { model: true } } },
        });
        await tx.asset.update({
          where: { id: item.assetId },
          data: { kitId, locationId: kit.locationId },
        });
        created.push(record);
      }
      return created;
    }),
  );
}

// ---------------------------------------------------------------------------
// removeSerializedItemFromKit
// ---------------------------------------------------------------------------
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

  return serialize(
    await prisma.$transaction(async (tx) => {
      await tx.kitSerializedItem.delete({
        where: { organizationId_assetId: { organizationId, assetId } },
      });

      await tx.asset.update({
        where: { id: assetId },
        data: { kitId: null, status: "AVAILABLE" },
      });

      return { success: true };
    }),
  );
}

// ---------------------------------------------------------------------------
// addBulkItemToKit
// ---------------------------------------------------------------------------
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

  return serialize(
    await prisma.$transaction(async (tx) => {
      const item = await tx.kitBulkItem.create({
        data: {
          organizationId,
          kitId,
          bulkAssetId: parsed.bulkAssetId,
          quantity: parsed.quantity,
          position: parsed.position,
          notes: parsed.notes,
          addedById: userId,
        },
        include: { bulkAsset: { include: { model: true } } },
      });

      await tx.bulkAsset.update({
        where: { id: parsed.bulkAssetId },
        data: { availableQuantity: { decrement: parsed.quantity } },
      });

      return item;
    }),
  );
}

// ---------------------------------------------------------------------------
// removeBulkItemFromKit
// ---------------------------------------------------------------------------
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

  return serialize(
    await prisma.$transaction(async (tx) => {
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

      return { success: true };
    }),
  );
}

// ---------------------------------------------------------------------------
// getAvailableAssetsForKit – serialized assets not in any kit
// ---------------------------------------------------------------------------
export async function getAvailableAssetsForKit(modelId?: string) {
  const { organizationId } = await getOrgContext();

  return serialize(
    await prisma.asset.findMany({
      where: {
        organizationId,
        isActive: true,
        status: "AVAILABLE",
        kitId: null,
        ...(modelId && { modelId }),
      },
      include: { model: true },
      orderBy: { assetTag: "asc" },
    }),
  );
}

// ---------------------------------------------------------------------------
// getAvailableBulkAssetsForKit – bulk assets with available quantity
// ---------------------------------------------------------------------------
export async function getAvailableBulkAssetsForKit() {
  const { organizationId } = await getOrgContext();

  return serialize(
    await prisma.bulkAsset.findMany({
      where: {
        organizationId,
        isActive: true,
        status: "ACTIVE",
        availableQuantity: { gt: 0 },
      },
      include: { model: true },
      orderBy: { assetTag: "asc" },
    }),
  );
}


