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

// ===========================================================================
// PREP-KIT OPERATIONS
// Prep-kits are temporary kits (isPrep: true) that group existing project
// line items. They use the same Kit model and checkout/checkin infrastructure.
// ===========================================================================

const PREP_KIT_INCLUDE = {
  lineItems: {
    where: { isKitChild: false },
    include: {
      childLineItems: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          model: true,
          asset: true,
          bulkAsset: true,
          kit: true,
          childLineItems: {
            orderBy: { sortOrder: "asc" as const },
            include: { model: true, asset: true, bulkAsset: true },
          },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// getProjectPrepKits — list all prep-kits for a project
// ---------------------------------------------------------------------------
export async function getProjectPrepKits(projectId: string) {
  const { organizationId } = await getOrgContext();

  const kits = await prisma.kit.findMany({
    where: { organizationId, isPrep: true, isActive: true },
    include: {
      ...PREP_KIT_INCLUDE,
    },
  });

  // Filter to kits that have a parent line item on this project
  const projectKits = kits.filter((kit) =>
    kit.lineItems.some((li) => li.projectId === projectId)
  );

  return serialize(projectKits);
}

// ---------------------------------------------------------------------------
// searchCaseAssets — search assets in the prep-kit case category tree
// ---------------------------------------------------------------------------
export async function searchCaseAssets(query: string) {
  const { organizationId } = await getOrgContext();
  const categoryIds = await getCaseCategoryIds();
  if (categoryIds.length === 0) return serialize([]);

  const assets = await prisma.asset.findMany({
    where: {
      organizationId,
      isActive: true,
      kitId: null, // Not already in a physical kit
      model: { categoryId: { in: categoryIds } },
      OR: [
        { assetTag: { contains: query, mode: "insensitive" } },
        { model: { name: { contains: query, mode: "insensitive" } } },
        { model: { modelNumber: { contains: query, mode: "insensitive" } } },
        { serialNumber: { contains: query, mode: "insensitive" } },
        { customName: { contains: query, mode: "insensitive" } },
      ],
    },
    include: {
      model: { select: { name: true, modelNumber: true, categoryId: true } },
    },
    take: 15,
    orderBy: { assetTag: "asc" },
  });

  return serialize(
    assets.map((a) => ({
      id: a.id,
      assetTag: a.assetTag,
      modelName: a.model.name,
      modelNumber: a.model.modelNumber,
      customName: a.customName,
      status: a.status,
      modelId: a.modelId,
      categoryId: a.model.categoryId,
    }))
  );
}

// ---------------------------------------------------------------------------
// createPrepKit — create a prep-kit and add it to a project
// ---------------------------------------------------------------------------
export async function createPrepKit(projectId: string, name: string, caseAssetId?: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  // Verify project exists
  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, projectNumber: true },
  });
  if (!project) throw new Error("Project not found");

  // If a case asset is provided, look it up
  let caseAsset: { id: string; assetTag: string; modelId: string; model: { name: string; categoryId: string | null } } | null = null;
  if (caseAssetId) {
    caseAsset = await prisma.asset.findUnique({
      where: { id: caseAssetId, organizationId },
      select: { id: true, assetTag: true, modelId: true, model: { select: { name: true, categoryId: true } } },
    });
    if (!caseAsset) throw new Error("Case asset not found");
  }

  const kitTag = caseAsset ? caseAsset.assetTag : `PREP-${Date.now().toString(36).toUpperCase()}`;
  const kitName = caseAsset ? `${caseAsset.model.name} (${caseAsset.assetTag})` : name;

  const maxSort = await prisma.projectLineItem.aggregate({
    where: { projectId, organizationId },
    _max: { sortOrder: true },
  });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  const result = await prisma.$transaction(async (tx) => {
    // Create Kit record
    const kit = await tx.kit.create({
      data: {
        organizationId,
        assetTag: kitTag,
        name: kitName,
        isPrep: true,
        status: "AVAILABLE",
        condition: "NEW",
        ...(caseAsset?.model.categoryId && { categoryId: caseAsset.model.categoryId }),
      },
    });

    // Create parent line item on the project
    const parentItem = await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId,
        type: "EQUIPMENT",
        kitId: kit.id,
        description: kitName,
        quantity: 1,
        pricingType: "PER_DAY",
        duration: 1,
        sortOrder: nextSort,
        pricingMode: "KIT_PRICE",
      },
    });

    // If case asset, add it to the project as a child of the prep-kit
    if (caseAsset) {
      // Check if the case asset is already on the project
      const existingLI = await tx.projectLineItem.findFirst({
        where: {
          projectId,
          assetId: caseAsset.id,
          organizationId,
          status: { notIn: ["CANCELLED"] },
        },
      });

      if (existingLI) {
        // Re-parent existing line item under the prep-kit
        await tx.projectLineItem.update({
          where: { id: existingLI.id },
          data: { isKitChild: true, parentLineItemId: parentItem.id },
        });
      } else {
        // Create a new child line item for the case asset
        await tx.projectLineItem.create({
          data: {
            organizationId,
            projectId,
            type: "EQUIPMENT",
            modelId: caseAsset.modelId,
            assetId: caseAsset.id,
            description: caseAsset.model.name,
            quantity: 1,
            pricingType: "PER_DAY",
            duration: 1,
            sortOrder: nextSort + 1,
            isKitChild: true,
            parentLineItemId: parentItem.id,
          },
        });
      }
    }

    return { kit, parentItem };
  });

  await logActivity({
    organizationId, userId, userName,
    action: "CREATE",
    entityType: "kit",
    entityId: result.kit.id,
    entityName: kitName,
    summary: `Created prep-kit "${kitName}" on ${project.projectNumber}`,
    projectId,
  });

  return serialize(result.kit);
}

// ---------------------------------------------------------------------------
// addItemToPrepKit — re-parent an existing project line item under the prep-kit
// ---------------------------------------------------------------------------
export async function addItemToPrepKit(
  prepKitId: string,
  lineItemId: string,
  quantity?: number, // For partial bulk quantities
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const kit = await prisma.kit.findUnique({
    where: { id: prepKitId, organizationId },
  });
  if (!kit || !kit.isPrep) throw new Error("Prep-kit not found");
  if (!kit.isActive) throw new Error("Prep-kit has been dissolved");

  // Find the prep-kit's parent line item
  const prepParent = await prisma.projectLineItem.findFirst({
    where: { kitId: prepKitId, isKitChild: false, organizationId },
  });
  if (!prepParent) throw new Error("Prep-kit parent line item not found");

  // Find the target line item
  const target = await prisma.projectLineItem.findUnique({
    where: { id: lineItemId, organizationId },
    include: { model: true, childLineItems: true, kit: true },
  });
  if (!target) throw new Error("Line item not found");
  if (target.projectId !== prepParent.projectId) throw new Error("Line item is not on the same project");
  if (target.isKitChild) throw new Error("Item is already in a kit or prep-kit");
  if (target.status === "CANCELLED") throw new Error("Cannot add a cancelled item");

  await prisma.$transaction(async (tx) => {
    const isKitParent = !!target.kitId && !target.isKitChild;
    const isBulk = !!target.bulkAssetId || (!target.assetId && target.quantity > 1);

    if (isKitParent) {
      // Re-parent the entire kit group (parent + children) under the prep-kit
      await tx.projectLineItem.update({
        where: { id: target.id },
        data: { isKitChild: true, parentLineItemId: prepParent.id },
      });
    } else if (isBulk && quantity && quantity < target.quantity) {
      // Partial bulk: split the line item
      await tx.projectLineItem.update({
        where: { id: target.id },
        data: { quantity: target.quantity - quantity },
      });
      // Create new child with the requested quantity
      await tx.projectLineItem.create({
        data: {
          organizationId: target.organizationId,
          projectId: target.projectId,
          type: target.type,
          modelId: target.modelId,
          bulkAssetId: target.bulkAssetId,
          description: target.description,
          quantity,
          pricingType: target.pricingType,
          duration: target.duration,
          sortOrder: target.sortOrder,
          isKitChild: true,
          parentLineItemId: prepParent.id,
        },
      });
    } else {
      // Regular item or full bulk quantity: just re-parent
      await tx.projectLineItem.update({
        where: { id: target.id },
        data: { isKitChild: true, parentLineItemId: prepParent.id },
      });
    }
  });

  await logActivity({
    organizationId, userId, userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: prepKitId,
    entityName: kit.name,
    summary: `Added ${target.model?.name || target.description || "item"} to prep-kit "${kit.name}"`,
    projectId: prepParent.projectId,
  });

  return serialize({ success: true });
}

// ---------------------------------------------------------------------------
// addItemToPrepKitByTag — scan an asset tag to add it to a prep-kit
// ---------------------------------------------------------------------------
export async function addItemToPrepKitByTag(
  prepKitId: string,
  assetTag: string,
  quantity?: number, // For bulk: add multiple at once (default 1)
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const kit = await prisma.kit.findUnique({
    where: { id: prepKitId, organizationId },
  });
  if (!kit || !kit.isPrep) throw new Error("Prep-kit not found");
  if (!kit.isActive) throw new Error("Prep-kit has been dissolved");

  const prepParent = await prisma.projectLineItem.findFirst({
    where: { kitId: prepKitId, isKitChild: false, organizationId },
  });
  if (!prepParent) throw new Error("Prep-kit parent line item not found");

  // Look up the asset tag across serialized assets, bulk assets, and kits
  const [asset, bulkAsset, scannedKit] = await Promise.all([
    prisma.asset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
      include: { model: true },
    }),
    prisma.bulkAsset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
      include: { model: true },
    }),
    prisma.kit.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
    }),
  ]);

  // Kit scan — find its line item on this project and re-parent it
  if (scannedKit) {
    if (scannedKit.id === prepKitId) throw new Error("Cannot add a prep-kit to itself");
    const kitLineItem = await prisma.projectLineItem.findFirst({
      where: {
        projectId: prepParent.projectId,
        kitId: scannedKit.id,
        isKitChild: false,
        status: { notIn: ["CANCELLED"] },
        organizationId,
      },
    });
    if (!kitLineItem) {
      return serialize({ success: false, error: "Kit is not on this project" });
    }
    if (kitLineItem.parentLineItemId === prepParent.id) {
      return serialize({ success: false, error: "Kit is already in this prep-kit" });
    }
    if (kitLineItem.isKitChild) {
      return serialize({ success: false, error: "Kit is already in another kit or prep-kit" });
    }
    // Re-use existing addItemToPrepKit logic
    return addItemToPrepKit(prepKitId, kitLineItem.id);
  }

  // Serialized asset scan — find the specific line item for this asset
  if (asset) {
    // If asset is inside a physical kit, it can't be added individually
    if (asset.kitId) {
      return serialize({ success: false, error: `${asset.model.name} is inside a kit — scan the kit instead` });
    }

    // First try: line item with this exact asset assigned
    let lineItem = await prisma.projectLineItem.findFirst({
      where: {
        projectId: prepParent.projectId,
        assetId: asset.id,
        status: { notIn: ["CANCELLED"] },
        organizationId,
      },
    });

    // Fallback: model-level line item (assetId is null) — project has qty N of the model
    if (!lineItem) {
      lineItem = await prisma.projectLineItem.findFirst({
        where: {
          projectId: prepParent.projectId,
          modelId: asset.modelId,
          assetId: null,
          isKitChild: false,
          status: { notIn: ["CANCELLED"] },
          organizationId,
        },
        orderBy: { sortOrder: "asc" },
      });
    }

    if (!lineItem) {
      return serialize({ success: false, error: `${asset.model.name} is not on this project` });
    }
    if (lineItem.parentLineItemId === prepParent.id) {
      return serialize({ success: false, error: `${asset.model.name} is already in this prep-kit` });
    }
    if (lineItem.isKitChild) {
      return serialize({ success: false, error: `${asset.model.name} is already in another kit or prep-kit` });
    }

    // If it's a model-level line item (no assetId), split off 1 unit and assign the asset
    if (!lineItem.assetId) {
      if (lineItem.quantity > 1) {
        // Split: reduce original qty and create a new child with the specific asset
        await prisma.$transaction(async (tx) => {
          await tx.projectLineItem.update({
            where: { id: lineItem!.id },
            data: { quantity: lineItem!.quantity - 1 },
          });
          await tx.projectLineItem.create({
            data: {
              organizationId: lineItem!.organizationId,
              projectId: lineItem!.projectId,
              type: lineItem!.type,
              modelId: lineItem!.modelId,
              assetId: asset!.id,
              description: lineItem!.description,
              quantity: 1,
              pricingType: lineItem!.pricingType,
              duration: lineItem!.duration,
              sortOrder: lineItem!.sortOrder,
              isKitChild: true,
              parentLineItemId: prepParent.id,
            },
          });
        });
      } else {
        // Last unit — assign asset and re-parent the whole line item
        await prisma.$transaction(async (tx) => {
          await tx.projectLineItem.update({
            where: { id: lineItem!.id },
            data: { assetId: asset!.id, isKitChild: true, parentLineItemId: prepParent.id },
          });
        });
      }

      await logActivity({
        organizationId, userId, userName,
        action: "UPDATE",
        entityType: "kit",
        entityId: prepKitId,
        entityName: kit.name,
        summary: `Added ${asset.model.name} (${assetTag}) to prep-kit "${kit.name}"`,
        projectId: prepParent.projectId,
      });

      return serialize({ success: true });
    }

    // Line item already has this specific asset assigned — just re-parent
    return addItemToPrepKit(prepKitId, lineItem.id);
  }

  // Bulk asset scan — find the line item and split off quantity
  if (bulkAsset) {
    // Try all line items for this model on the project that aren't prep-kit children
    const candidates = await prisma.projectLineItem.findMany({
      where: {
        projectId: prepParent.projectId,
        modelId: bulkAsset.modelId,
        isKitChild: false,
        parentLineItemId: null,
        status: { notIn: ["CANCELLED"] },
        organizationId,
        quantity: { gt: 0 },
      },
      orderBy: { sortOrder: "asc" },
    });

    // Prefer exact bulkAssetId match, then any matching model
    let lineItem = candidates.find((c) => c.bulkAssetId === bulkAsset!.id)
      ?? candidates.find((c) => !c.bulkAssetId && !c.assetId)
      ?? candidates[0]
      ?? null;

    if (!lineItem) {
      // No remaining quantity on project — tell UI to prompt "add to project" flow
      return serialize({
        success: false,
        needsProjectAdd: true,
        bulkAssetId: bulkAsset.id,
        modelId: bulkAsset.modelId,
        name: bulkAsset.model.name,
        assetTag: bulkAsset.assetTag,
        error: `No more ${bulkAsset.model.name} on this project — add more?`,
      });
    }

    const addQty = Math.min(quantity ?? 1, lineItem.quantity);
    if (addQty < 1) {
      return serialize({ success: false, error: `No more ${bulkAsset.model.name} available to add` });
    }

    // Check if there's already a child in this prep-kit for the same model — increment qty
    const existingChild = await prisma.projectLineItem.findFirst({
      where: {
        parentLineItemId: prepParent.id,
        modelId: bulkAsset.modelId,
        isKitChild: true,
        organizationId,
      },
    });

    await prisma.$transaction(async (tx) => {
      // Decrease source qty
      if (lineItem!.quantity <= addQty) {
        // Taking all remaining — delete or re-parent the source
        if (existingChild) {
          await tx.projectLineItem.delete({ where: { id: lineItem!.id } });
        } else {
          await tx.projectLineItem.update({
            where: { id: lineItem!.id },
            data: { bulkAssetId: bulkAsset!.id, isKitChild: true, parentLineItemId: prepParent.id, quantity: addQty },
          });
        }
      } else {
        await tx.projectLineItem.update({
          where: { id: lineItem!.id },
          data: { quantity: lineItem!.quantity - addQty },
        });
      }

      if (existingChild) {
        // Increment existing child's quantity
        await tx.projectLineItem.update({
          where: { id: existingChild.id },
          data: { quantity: existingChild.quantity + addQty },
        });
      } else if (lineItem!.quantity > addQty) {
        // Create new child (only if we didn't re-parent the source above)
        await tx.projectLineItem.create({
          data: {
            organizationId: lineItem!.organizationId,
            projectId: lineItem!.projectId,
            type: lineItem!.type,
            modelId: lineItem!.modelId,
            bulkAssetId: bulkAsset!.id,
            description: lineItem!.description,
            quantity: addQty,
            pricingType: lineItem!.pricingType,
            duration: lineItem!.duration,
            sortOrder: lineItem!.sortOrder,
            isKitChild: true,
            parentLineItemId: prepParent.id,
          },
        });
      }
    });

    await logActivity({
      organizationId, userId, userName,
      action: "UPDATE",
      entityType: "kit",
      entityId: prepKitId,
      entityName: kit.name,
      summary: `Added ${bulkAsset.model.name} x${addQty} to prep-kit "${kit.name}"`,
      projectId: prepParent.projectId,
    });

    return serialize({ success: true });
  }

  return serialize({ success: false, error: `Asset tag "${assetTag}" not found` });
}

// ---------------------------------------------------------------------------
// searchPrepKitItems — search all org assets by name/tag
// Returns individual serialized assets, bulk assets matching the query.
// Flags whether each result is already on the project or not.
// ---------------------------------------------------------------------------
export async function searchPrepKitItems(prepKitId: string, query: string) {
  const { organizationId } = await getOrgContext();

  const kit = await prisma.kit.findUnique({
    where: { id: prepKitId, organizationId },
  });
  if (!kit || !kit.isPrep) throw new Error("Prep-kit not found");

  const prepParent = await prisma.projectLineItem.findFirst({
    where: { kitId: prepKitId, isKitChild: false, organizationId },
  });
  if (!prepParent) throw new Error("Prep-kit parent line item not found");

  const projectId = prepParent.projectId;

  // Get project line items to know what's already on the project
  const projectLineItems = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      organizationId,
      isKitChild: false,
      parentLineItemId: null,
      status: { notIn: ["CANCELLED"] },
      kitId: null,
    },
    select: { id: true, modelId: true, assetId: true, bulkAssetId: true, quantity: true },
  });

  // Assets already in this prep-kit
  const childAssetIds = new Set(
    (await prisma.projectLineItem.findMany({
      where: { parentLineItemId: prepParent.id, assetId: { not: null }, organizationId },
      select: { assetId: true },
    })).map((c) => c.assetId)
  );
  const childBulkModelIds = new Set(
    (await prisma.projectLineItem.findMany({
      where: { parentLineItemId: prepParent.id, bulkAssetId: { not: null }, organizationId },
      select: { modelId: true },
    })).map((c) => c.modelId)
  );

  const searchFilter = {
    OR: [
      { assetTag: { contains: query, mode: "insensitive" as const } },
      { model: { name: { contains: query, mode: "insensitive" as const } } },
      { model: { modelNumber: { contains: query, mode: "insensitive" as const } } },
    ],
  };

  // Search ALL serialized assets in the org
  const serializedAssets = await prisma.asset.findMany({
    where: {
      organizationId,
      isActive: true,
      kitId: null, // Not in a physical kit
      ...searchFilter,
    },
    include: { model: { select: { name: true, modelNumber: true } } },
    take: 25,
    orderBy: { assetTag: "asc" },
  });

  // Search ALL bulk assets in the org
  const bulkAssets = await prisma.bulkAsset.findMany({
    where: {
      organizationId,
      isActive: true,
      ...searchFilter,
    },
    include: { model: { select: { name: true, modelNumber: true } } },
    take: 10,
    orderBy: { assetTag: "asc" },
  });

  // Count how many of each bulk are already in this prep-kit
  const prepChildBulks = await prisma.projectLineItem.findMany({
    where: { parentLineItemId: prepParent.id, bulkAssetId: { not: null }, organizationId },
    select: { bulkAssetId: true, modelId: true, quantity: true },
  });
  const prepChildBulkQtyMap = new Map<string, number>();
  for (const c of prepChildBulks) {
    const key = c.bulkAssetId || c.modelId || "";
    prepChildBulkQtyMap.set(key, (prepChildBulkQtyMap.get(key) || 0) + c.quantity);
  }

  // Build a lookup of what's on the project
  const projectAssetIds = new Set(projectLineItems.filter((li) => li.assetId).map((li) => li.assetId!));
  const projectModelIds = new Set(projectLineItems.filter((li) => li.modelId).map((li) => li.modelId!));
  const projectBulkAssetIds = new Set(projectLineItems.filter((li) => li.bulkAssetId).map((li) => li.bulkAssetId!));

  // For bulk assets on the project, get available quantity (by bulkAssetId or modelId)
  const bulkLineItemMap = new Map<string, { id: string; quantity: number }>();
  const modelLineItemMap = new Map<string, { id: string; quantity: number }>();
  for (const li of projectLineItems) {
    if (li.bulkAssetId && li.quantity > 0) {
      bulkLineItemMap.set(li.bulkAssetId, { id: li.id, quantity: li.quantity });
    } else if (li.modelId && !li.assetId && !li.bulkAssetId && li.quantity > 0) {
      // Model-level line item (no specific bulk/asset assigned) — could match bulk assets
      modelLineItemMap.set(li.modelId, { id: li.id, quantity: li.quantity });
    }
  }

  type SearchResult = {
    type: "serialized" | "bulk";
    assetTag: string;
    name: string;
    modelNumber: string | null;
    scanTag: string;
    onProject: boolean;
    // For bulk: quantity on the project line item (not in a prep-kit)
    onProjectQty?: number;
    // For bulk: currently available quantity in org inventory
    availableQty?: number;
    // For bulk: total quantity owned by org
    totalQty?: number;
    // For items not on project: IDs needed to add them
    assetId?: string;
    bulkAssetId?: string;
    modelId?: string;
  };

  const results: SearchResult[] = [];

  for (const asset of serializedAssets) {
    if (childAssetIds.has(asset.id)) continue; // Already in prep-kit
    const onProject = projectAssetIds.has(asset.id) || projectModelIds.has(asset.modelId);
    results.push({
      type: "serialized",
      assetTag: asset.assetTag,
      name: asset.model.name,
      modelNumber: asset.model.modelNumber ?? null,
      scanTag: asset.assetTag,
      onProject,
      assetId: asset.id,
      modelId: asset.modelId,
    });
  }

  for (const bulk of bulkAssets) {
    const onProject = projectBulkAssetIds.has(bulk.id) || projectModelIds.has(bulk.modelId);
    const liInfo = bulkLineItemMap.get(bulk.id) || modelLineItemMap.get(bulk.modelId);
    const alreadyInPrep = prepChildBulkQtyMap.get(bulk.id) || prepChildBulkQtyMap.get(bulk.modelId) || 0;
    // Skip if on project but no quantity left AND none can be added from org
    if (onProject && liInfo && liInfo.quantity <= 0 && alreadyInPrep >= bulk.totalQuantity) continue;
    results.push({
      type: "bulk",
      assetTag: bulk.assetTag,
      name: bulk.model.name,
      modelNumber: bulk.model.modelNumber ?? null,
      scanTag: bulk.assetTag,
      onProject,
      onProjectQty: liInfo?.quantity ?? 0,
      availableQty: bulk.availableQuantity,
      totalQty: bulk.totalQuantity,
      bulkAssetId: bulk.id,
      modelId: bulk.modelId,
    });
  }

  return serialize(results);
}

// ---------------------------------------------------------------------------
// addToPrepKitAndProject — add an asset/bulk to the project, then to prep-kit
// Used when searching finds an item not yet on the project.
// ---------------------------------------------------------------------------
export async function addToPrepKitAndProject(
  prepKitId: string,
  opts: {
    assetId?: string;
    bulkAssetId?: string;
    modelId: string;
    quantity?: number;       // Total qty to end up in prep-kit (bulk only)
    addToProjectQty?: number; // How many of those need adding to project first
  },
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const kit = await prisma.kit.findUnique({
    where: { id: prepKitId, organizationId },
  });
  if (!kit || !kit.isPrep) throw new Error("Prep-kit not found");
  if (!kit.isActive) throw new Error("Prep-kit has been dissolved");

  const prepParent = await prisma.projectLineItem.findFirst({
    where: { kitId: prepKitId, isKitChild: false, organizationId },
  });
  if (!prepParent) throw new Error("Prep-kit parent line item not found");

  const model = await prisma.model.findUnique({
    where: { id: opts.modelId, organizationId },
    select: { name: true },
  });
  if (!model) throw new Error("Model not found");

  const totalQty = opts.quantity ?? 1;
  const addToProjectQty = opts.addToProjectQty ?? totalQty;
  const fromExistingQty = totalQty - addToProjectQty;

  const maxSort = await prisma.projectLineItem.aggregate({
    where: { projectId: prepParent.projectId, organizationId },
    _max: { sortOrder: true },
  });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  await prisma.$transaction(async (tx) => {
    // Step 1: If some qty needs to come from existing project line items, move it
    if (fromExistingQty > 0 && opts.bulkAssetId) {
      const existingLi = await tx.projectLineItem.findFirst({
        where: {
          projectId: prepParent.projectId,
          bulkAssetId: opts.bulkAssetId,
          isKitChild: false,
          parentLineItemId: null,
          status: { notIn: ["CANCELLED"] },
          organizationId,
        },
      });
      if (existingLi && existingLi.quantity > 0) {
        const take = Math.min(fromExistingQty, existingLi.quantity);
        await tx.projectLineItem.update({
          where: { id: existingLi.id },
          data: { quantity: existingLi.quantity - take },
        });
      }
    }

    // Step 2: Check if there's already a child in this prep-kit for this model
    const existingChild = await tx.projectLineItem.findFirst({
      where: {
        parentLineItemId: prepParent.id,
        modelId: opts.modelId,
        isKitChild: true,
        organizationId,
      },
    });

    if (existingChild) {
      // Increment existing child
      await tx.projectLineItem.update({
        where: { id: existingChild.id },
        data: { quantity: existingChild.quantity + totalQty },
      });
    } else {
      // Create new child line item
      await tx.projectLineItem.create({
        data: {
          organizationId,
          projectId: prepParent.projectId,
          type: "EQUIPMENT",
          modelId: opts.modelId,
          assetId: opts.assetId ?? null,
          bulkAssetId: opts.bulkAssetId ?? null,
          description: model!.name,
          quantity: totalQty,
          pricingType: "PER_DAY",
          duration: 1,
          sortOrder: nextSort,
          isKitChild: true,
          parentLineItemId: prepParent.id,
        },
      });
    }
  });

  await logActivity({
    organizationId, userId, userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: prepKitId,
    entityName: kit.name,
    summary: `Added ${totalQty}x ${model.name} to project and prep-kit "${kit.name}"`,
    projectId: prepParent.projectId,
  });

  return serialize({ success: true });
}

// ---------------------------------------------------------------------------
// removeItemFromPrepKit — un-parent a line item back to standalone
// ---------------------------------------------------------------------------
export async function removeItemFromPrepKit(
  prepKitId: string,
  lineItemId: string,
  quantity?: number, // For removing partial bulk quantity (default: remove all)
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const kit = await prisma.kit.findUnique({
    where: { id: prepKitId, organizationId },
  });
  if (!kit || !kit.isPrep) throw new Error("Prep-kit not found");

  const prepParent = await prisma.projectLineItem.findFirst({
    where: { kitId: prepKitId, isKitChild: false, organizationId },
  });
  if (!prepParent) throw new Error("Prep-kit parent line item not found");

  const target = await prisma.projectLineItem.findUnique({
    where: { id: lineItemId, organizationId },
    include: { model: true },
  });
  if (!target) throw new Error("Line item not found");
  if (target.parentLineItemId !== prepParent.id) throw new Error("Item is not in this prep-kit");

  await prisma.$transaction(async (tx) => {
    const isNestedKitParent = !!target.kitId;

    if (isNestedKitParent) {
      // Un-parent the kit (its children stay under it)
      await tx.projectLineItem.update({
        where: { id: target.id },
        data: { isKitChild: false, parentLineItemId: null },
      });
    } else if (target.bulkAssetId) {
      const removeQty = quantity ?? target.quantity; // Default: remove all
      const keepQty = target.quantity - removeQty;

      // Check if this was a split — find the remainder line item
      let remainder = await tx.projectLineItem.findFirst({
        where: {
          projectId: target.projectId,
          bulkAssetId: target.bulkAssetId,
          isKitChild: false,
          id: { not: target.id },
          organizationId,
        },
      });
      // Fallback: model-level line item (no bulkAssetId, same modelId)
      if (!remainder && target.modelId) {
        remainder = await tx.projectLineItem.findFirst({
          where: {
            projectId: target.projectId,
            modelId: target.modelId,
            assetId: null,
            bulkAssetId: null,
            isKitChild: false,
            id: { not: target.id },
            parentLineItemId: null,
            organizationId,
          },
        });
      }

      if (keepQty > 0) {
        // Partial removal — reduce child qty, add back to remainder
        await tx.projectLineItem.update({
          where: { id: target.id },
          data: { quantity: keepQty },
        });
        if (remainder) {
          await tx.projectLineItem.update({
            where: { id: remainder.id },
            data: { quantity: remainder.quantity + removeQty },
          });
        }
      } else if (remainder) {
        // Full removal with remainder — merge back and delete child
        await tx.projectLineItem.update({
          where: { id: remainder.id },
          data: { quantity: remainder.quantity + target.quantity },
        });
        await tx.projectLineItem.delete({ where: { id: target.id } });
      } else {
        // No remainder — un-parent and clear bulkAssetId
        await tx.projectLineItem.update({
          where: { id: target.id },
          data: { isKitChild: false, parentLineItemId: null, bulkAssetId: null },
        });
      }
    } else if (target.assetId && target.modelId) {
      // Serialized asset split from a model-level line item — merge back
      const modelLineItem = await tx.projectLineItem.findFirst({
        where: {
          projectId: target.projectId,
          modelId: target.modelId,
          assetId: null,
          isKitChild: false,
          id: { not: target.id },
          organizationId,
        },
      });
      if (modelLineItem) {
        // Merge back: increment model-level qty and delete the split child
        await tx.projectLineItem.update({
          where: { id: modelLineItem.id },
          data: { quantity: modelLineItem.quantity + 1 },
        });
        await tx.projectLineItem.delete({ where: { id: target.id } });
      } else {
        // No model-level line item found — un-parent and clear assetId
        await tx.projectLineItem.update({
          where: { id: target.id },
          data: { isKitChild: false, parentLineItemId: null, assetId: null },
        });
      }
    } else {
      // Regular item — un-parent
      await tx.projectLineItem.update({
        where: { id: target.id },
        data: { isKitChild: false, parentLineItemId: null },
      });
    }
  });

  await logActivity({
    organizationId, userId, userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: prepKitId,
    entityName: kit.name,
    summary: `Removed ${target.model?.name || target.description || "item"} from prep-kit "${kit.name}"`,
    projectId: prepParent.projectId,
  });

  return serialize({ success: true });
}

// ---------------------------------------------------------------------------
// dissolvePrepKit — unpack: un-parent all children, archive the prep-kit
// ---------------------------------------------------------------------------
export async function dissolvePrepKit(kitId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const kit = await prisma.kit.findUnique({
    where: { id: kitId, organizationId },
  });
  if (!kit || !kit.isPrep) throw new Error("Prep-kit not found");

  const prepParent = await prisma.projectLineItem.findFirst({
    where: { kitId, isKitChild: false, organizationId },
    include: {
      childLineItems: {
        include: { childLineItems: true },
      },
    },
  });
  if (!prepParent) throw new Error("Prep-kit parent line item not found");

  // Prep-kit must be AVAILABLE or RETURNED to dissolve
  if (prepParent.status === "CHECKED_OUT") {
    throw new Error("Cannot dissolve a prep-kit that is currently deployed. Return it first.");
  }

  const projectId = prepParent.projectId;

  await prisma.$transaction(async (tx) => {
    for (const child of prepParent.childLineItems) {
      const isNestedKitParent = !!child.kitId;

      if (isNestedKitParent) {
        // Un-parent the nested kit — it becomes standalone on the project
        await tx.projectLineItem.update({
          where: { id: child.id },
          data: { isKitChild: false, parentLineItemId: null },
        });
      } else if (child.bulkAssetId) {
        // Check if this was a split — merge back
        let remainder = await tx.projectLineItem.findFirst({
          where: {
            projectId,
            bulkAssetId: child.bulkAssetId,
            isKitChild: false,
            id: { not: child.id },
            parentLineItemId: null,
            organizationId,
          },
        });
        // Fallback: model-level line item (no bulkAssetId, same modelId)
        if (!remainder && child.modelId) {
          remainder = await tx.projectLineItem.findFirst({
            where: {
              projectId,
              modelId: child.modelId,
              assetId: null,
              bulkAssetId: null,
              isKitChild: false,
              id: { not: child.id },
              parentLineItemId: null,
              organizationId,
            },
          });
        }
        if (remainder) {
          await tx.projectLineItem.update({
            where: { id: remainder.id },
            data: { quantity: remainder.quantity + child.quantity },
          });
          await tx.projectLineItem.delete({ where: { id: child.id } });
        } else {
          await tx.projectLineItem.update({
            where: { id: child.id },
            data: { isKitChild: false, parentLineItemId: null, bulkAssetId: null },
          });
        }
      } else if (child.assetId && child.modelId) {
        // Serialized asset split — merge back into model-level line item
        const modelLineItem = await tx.projectLineItem.findFirst({
          where: {
            projectId,
            modelId: child.modelId,
            assetId: null,
            isKitChild: false,
            id: { not: child.id },
            parentLineItemId: null,
            organizationId,
          },
        });
        if (modelLineItem) {
          await tx.projectLineItem.update({
            where: { id: modelLineItem.id },
            data: { quantity: modelLineItem.quantity + 1 },
          });
          await tx.projectLineItem.delete({ where: { id: child.id } });
        } else {
          // No model-level line item — un-parent and clear assetId
          await tx.projectLineItem.update({
            where: { id: child.id },
            data: { isKitChild: false, parentLineItemId: null, assetId: null },
          });
        }
      } else {
        // Regular item — un-parent
        await tx.projectLineItem.update({
          where: { id: child.id },
          data: { isKitChild: false, parentLineItemId: null },
        });
      }
    }

    // Delete the prep-kit parent line item
    await tx.projectLineItem.delete({ where: { id: prepParent.id } });

    // Delete the prep-kit record entirely
    await tx.kit.delete({ where: { id: kitId } });
  });

  await logActivity({
    organizationId, userId, userName,
    action: "STATUS_CHANGE",
    entityType: "kit",
    entityId: kitId,
    entityName: kit.name,
    summary: `Dissolved prep-kit "${kit.name}"`,
    projectId,
  });

  return serialize({ success: true });
}
