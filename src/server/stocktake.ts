"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  createStocktakeSchema,
  type CreateStocktakeValues,
  updateStocktakeSchema,
  type UpdateStocktakeValues,
  scanItemSchema,
  type ScanItemValues,
  updateBulkCountSchema,
  type UpdateBulkCountValues,
  resolveDiscrepancySchema,
  type ResolveDiscrepancyValues,
  bulkResolveSchema,
  type BulkResolveValues,
} from "@/lib/validations/stocktake";

// ---------------------------------------------------------------------------
// 0. syncStocktakeOnLocationChange — update active stocktakes when asset moves
// ---------------------------------------------------------------------------

export async function syncStocktakeOnLocationChange({
  assetId,
  bulkAssetId,
  oldLocationId,
  newLocationId,
  organizationId,
}: {
  assetId?: string;
  bulkAssetId?: string;
  oldLocationId: string | null;
  newLocationId: string | null;
  organizationId: string;
}) {
  if (oldLocationId === newLocationId) return;

  // Find active stocktakes at old/new locations
  const [oldStocktake, newStocktake] = await Promise.all([
    oldLocationId
      ? prisma.stocktake.findFirst({
          where: { organizationId, locationId: oldLocationId, status: "IN_PROGRESS" },
        })
      : null,
    newLocationId
      ? prisma.stocktake.findFirst({
          where: { organizationId, locationId: newLocationId, status: "IN_PROGRESS" },
        })
      : null,
  ]);

  // Asset moved AWAY from a stocktake location
  if (oldStocktake) {
    const itemWhere = {
      stocktakeId: oldStocktake.id,
      ...(assetId ? { assetId } : { bulkAssetId }),
    };
    const existingItem = await prisma.stocktakeItem.findFirst({ where: itemWhere });
    if (existingItem && existingItem.expectedAtLocation) {
      await prisma.stocktakeItem.update({
        where: { id: existingItem.id },
        data: { result: "WRONG_LOCATION", found: false },
      });
    }
  }

  // Asset moved INTO a stocktake location
  if (newStocktake) {
    const itemWhere = {
      stocktakeId: newStocktake.id,
      ...(assetId ? { assetId } : { bulkAssetId }),
    };
    const existingItem = await prisma.stocktakeItem.findFirst({ where: itemWhere });
    if (!existingItem) {
      await prisma.stocktakeItem.create({
        data: {
          stocktakeId: newStocktake.id,
          ...(assetId ? { assetId } : { bulkAssetId }),
          expectedAtLocation: false,
          expectedQuantity: 1,
          found: false,
          result: "UNEXPECTED",
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 1. getStocktakes — paginated list
// ---------------------------------------------------------------------------

export async function getStocktakes(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  search?: string;
}) {
  const { organizationId } = await requirePermission("stocktake", "read");

  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 25;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = { organizationId };
  if (params?.status) where.status = params.status;
  if (params?.search) {
    where.name = { contains: params.search, mode: "insensitive" };
  }

  const orderBy: Record<string, string> = {};
  if (params?.sortField) {
    orderBy[params.sortField] = params.sortDirection ?? "desc";
  } else {
    orderBy.createdAt = "desc";
  }

  const [items, total] = await Promise.all([
    prisma.stocktake.findMany({
      where,
      include: { location: true, startedBy: true },
      orderBy,
      skip,
      take: pageSize,
    }),
    prisma.stocktake.count({ where }),
  ]);

  return serialize({ items, total, page, pageSize });
}

// ---------------------------------------------------------------------------
// 2. getStocktakeById — full detail with items
// ---------------------------------------------------------------------------

export async function getStocktakeById(id: string) {
  const { organizationId } = await requirePermission("stocktake", "read");

  const stocktake = await prisma.stocktake.findUnique({
    where: { id, organizationId },
    include: {
      location: true,
      startedBy: true,
      reviewedBy: true,
      items: {
        include: {
          asset: { include: { model: true } },
          bulkAsset: { include: { model: true } },
        },
        orderBy: { result: "asc" },
      },
    },
  });

  if (!stocktake) throw new Error("Stocktake not found");
  return serialize(stocktake);
}

// ---------------------------------------------------------------------------
// 3. getStocktakeProgress — lightweight counts for scanner tally
// ---------------------------------------------------------------------------

export async function getStocktakeProgress(id: string) {
  const { organizationId } = await requirePermission("stocktake", "read");

  const stocktake = await prisma.stocktake.findUnique({
    where: { id, organizationId },
    select: {
      id: true,
      status: true,
      expectedCount: true,
      _count: { select: { items: { where: { found: true } } } },
    },
  });

  if (!stocktake) throw new Error("Stocktake not found");

  return serialize({
    expectedCount: stocktake.expectedCount,
    foundCount: stocktake._count.items,
    status: stocktake.status,
  });
}

// ---------------------------------------------------------------------------
// 4. createStocktake — create DRAFT + generate expected items
// ---------------------------------------------------------------------------

export async function createStocktake(data: CreateStocktakeValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "create",
  );

  const parsed = createStocktakeSchema.parse(data);

  // Verify location belongs to org
  const location = await prisma.location.findFirst({
    where: { id: parsed.locationId, organizationId },
  });
  if (!location) throw new Error("Location not found");

  // Build asset filter based on scope
  const assetWhere: Record<string, unknown> = {
    organizationId,
    locationId: parsed.locationId,
    status: { in: ["AVAILABLE", "IN_MAINTENANCE"] },
    isActive: true,
  };
  const bulkWhere: Record<string, unknown> = {
    organizationId,
    locationId: parsed.locationId,
    isActive: true,
    status: { not: "RETIRED" },
  };

  if (parsed.scope === "CATEGORY" && parsed.categoryId) {
    assetWhere.model = { categoryId: parsed.categoryId };
    bulkWhere.model = { categoryId: parsed.categoryId };
  }

  // Query expected assets
  const [assets, bulkAssets] = await Promise.all([
    prisma.asset.findMany({ where: assetWhere, select: { id: true } }),
    prisma.bulkAsset.findMany({
      where: bulkWhere,
      select: { id: true, availableQuantity: true },
    }),
  ]);

  const expectedCount = assets.length + bulkAssets.length;

  // Create stocktake + items in transaction
  const stocktake = await prisma.$transaction(async (tx) => {
    const st = await tx.stocktake.create({
      data: {
        organizationId,
        name: parsed.name,
        locationId: parsed.locationId,
        scope: parsed.scope,
        categoryId: parsed.categoryId,
        notes: parsed.notes,
        expectedCount,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        startedById: userId,
      },
    });

    // Create items for serialized assets
    if (assets.length > 0) {
      await tx.stocktakeItem.createMany({
        data: assets.map((a) => ({
          stocktakeId: st.id,
          assetId: a.id,
          expectedAtLocation: true,
          expectedQuantity: 1,
        })),
      });
    }

    // Create items for bulk assets
    if (bulkAssets.length > 0) {
      await tx.stocktakeItem.createMany({
        data: bulkAssets.map((ba) => ({
          stocktakeId: st.id,
          bulkAssetId: ba.id,
          expectedAtLocation: true,
          expectedQuantity: ba.availableQuantity,
        })),
      });
    }

    return st;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "stocktake",
    entityId: stocktake.id,
    entityName: stocktake.name,
    summary: `Created stocktake "${stocktake.name}" at ${location.name} (${expectedCount} expected items)`,
  });

  return serialize(stocktake);
}

// ---------------------------------------------------------------------------
// 4b. updateStocktake — edit a DRAFT stocktake
// ---------------------------------------------------------------------------

export async function updateStocktake(id: string, data: UpdateStocktakeValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "manage",
  );

  const parsed = updateStocktakeSchema.parse(data);

  // Verify stocktake exists and is still DRAFT
  const existing = await prisma.stocktake.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Stocktake not found");
  if (existing.status !== "DRAFT" && existing.status !== "IN_PROGRESS") {
    throw new Error("Only draft or in-progress stocktakes can be edited");
  }

  // Verify location belongs to org
  const location = await prisma.location.findFirst({
    where: { id: parsed.locationId, organizationId },
  });
  if (!location) throw new Error("Location not found");

  // Check if location/scope/category changed — need to regenerate items
  const needsRegenerate =
    existing.locationId !== parsed.locationId ||
    existing.scope !== parsed.scope ||
    existing.categoryId !== (parsed.categoryId ?? null);

  if (needsRegenerate) {
    // Build asset filter based on scope
    const assetWhere: Record<string, unknown> = {
      organizationId,
      locationId: parsed.locationId,
      status: { in: ["AVAILABLE", "IN_MAINTENANCE"] },
      isActive: true,
    };
    const bulkWhere: Record<string, unknown> = {
      organizationId,
      locationId: parsed.locationId,
      isActive: true,
      status: { not: "RETIRED" },
    };

    if (parsed.scope === "CATEGORY" && parsed.categoryId) {
      assetWhere.model = { categoryId: parsed.categoryId };
      bulkWhere.model = { categoryId: parsed.categoryId };
    }

    const [assets, bulkAssets] = await Promise.all([
      prisma.asset.findMany({ where: assetWhere, select: { id: true } }),
      prisma.bulkAsset.findMany({
        where: bulkWhere,
        select: { id: true, availableQuantity: true },
      }),
    ]);

    const expectedCount = assets.length + bulkAssets.length;

    const stocktake = await prisma.$transaction(async (tx) => {
      // Delete old items
      await tx.stocktakeItem.deleteMany({ where: { stocktakeId: id } });

      // Update stocktake
      const st = await tx.stocktake.update({
        where: { id },
        data: {
          name: parsed.name,
          locationId: parsed.locationId,
          scope: parsed.scope,
          categoryId: parsed.categoryId ?? null,
          notes: parsed.notes ?? null,
          expectedCount,
        },
      });

      // Recreate items for serialized assets
      if (assets.length > 0) {
        await tx.stocktakeItem.createMany({
          data: assets.map((a) => ({
            stocktakeId: st.id,
            assetId: a.id,
            expectedAtLocation: true,
            expectedQuantity: 1,
          })),
        });
      }

      // Recreate items for bulk assets
      if (bulkAssets.length > 0) {
        await tx.stocktakeItem.createMany({
          data: bulkAssets.map((ba) => ({
            stocktakeId: st.id,
            bulkAssetId: ba.id,
            expectedAtLocation: true,
            expectedQuantity: ba.availableQuantity,
          })),
        });
      }

      return st;
    });

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "stocktake",
      entityId: stocktake.id,
      entityName: stocktake.name,
      summary: `Updated stocktake "${stocktake.name}" — regenerated ${expectedCount} expected items`,
    });

    return serialize(stocktake);
  }

  // Simple update — no item regeneration needed
  const stocktake = await prisma.stocktake.update({
    where: { id },
    data: {
      name: parsed.name,
      notes: parsed.notes ?? null,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "stocktake",
    entityId: stocktake.id,
    entityName: stocktake.name,
    summary: `Updated stocktake "${stocktake.name}"`,
  });

  return serialize(stocktake);
}

// ---------------------------------------------------------------------------
// 5. startStocktake — transition DRAFT → IN_PROGRESS
// ---------------------------------------------------------------------------

export async function startStocktake(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "manage",
  );

  const stocktake = await prisma.stocktake.findUnique({
    where: { id, organizationId },
  });
  if (!stocktake) throw new Error("Stocktake not found");
  if (stocktake.status !== "DRAFT")
    throw new Error("Stocktake must be in DRAFT status to start");

  await prisma.stocktake.update({
    where: { id },
    data: {
      status: "IN_PROGRESS",
      startedAt: new Date(),
      startedById: userId,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "stocktake",
    entityId: id,
    entityName: stocktake.name,
    summary: `Started stocktake "${stocktake.name}"`,
  });
}

// ---------------------------------------------------------------------------
// 6. scanStocktakeItem — process a barcode scan
// ---------------------------------------------------------------------------

export async function scanStocktakeItem(data: ScanItemValues) {
  const { organizationId, userId } = await requirePermission(
    "stocktake",
    "manage",
  );

  const parsed = scanItemSchema.parse(data);

  const stocktake = await prisma.stocktake.findUnique({
    where: { id: parsed.stocktakeId, organizationId },
  });
  if (!stocktake) throw new Error("Stocktake not found");
  if (stocktake.status !== "IN_PROGRESS")
    throw new Error("Stocktake is not in scanning mode");

  const tag = parsed.assetTag.trim();

  // Look up asset or bulk asset by tag
  const [asset, bulkAsset] = await Promise.all([
    prisma.asset.findFirst({
      where: { assetTag: tag, organizationId },
      include: { model: true },
    }),
    prisma.bulkAsset.findFirst({
      where: { assetTag: tag, organizationId },
      include: { model: true },
    }),
  ]);

  if (!asset && !bulkAsset) {
    throw new Error(`No asset found with tag "${tag}"`);
  }

  // Check if there's already an expected item for this asset
  const existingItem = await prisma.stocktakeItem.findFirst({
    where: {
      stocktakeId: parsed.stocktakeId,
      ...(asset ? { assetId: asset.id } : { bulkAssetId: bulkAsset!.id }),
    },
    include: {
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
    },
  });

  if (existingItem) {
    // Already in expected list
    if (existingItem.found) {
      // Allow re-scan — just update timestamp
      const updated = await prisma.stocktakeItem.update({
        where: { id: existingItem.id },
        data: { scannedAt: new Date(), scannedById: userId },
        include: {
          asset: { include: { model: true } },
          bulkAsset: { include: { model: true } },
        },
      });
      return serialize({
        ...updated,
        alreadyScanned: true,
        isExpected: existingItem.expectedAtLocation,
      });
    }

    const updated = await prisma.stocktakeItem.update({
      where: { id: existingItem.id },
      data: {
        found: true,
        foundQuantity: existingItem.expectedQuantity,
        scannedAt: new Date(),
        scannedById: userId,
        result: "MATCH",
      },
      include: {
        asset: { include: { model: true } },
        bulkAsset: { include: { model: true } },
      },
    });

    return serialize({ ...updated, alreadyScanned: false, isExpected: true });
  }

  // Not in expected list — determine why
  let result: "UNEXPECTED" | "WRONG_LOCATION" = "UNEXPECTED";

  if (asset) {
    // Check if asset is at a different location
    if (
      asset.locationId &&
      asset.locationId !== stocktake.locationId &&
      asset.status === "AVAILABLE"
    ) {
      result = "WRONG_LOCATION";
    }
  }

  // Create a new unexpected item
  const newItem = await prisma.stocktakeItem.create({
    data: {
      stocktakeId: parsed.stocktakeId,
      assetId: asset?.id,
      bulkAssetId: bulkAsset?.id,
      expectedAtLocation: false,
      expectedQuantity: 0,
      found: true,
      foundQuantity: 1,
      scannedAt: new Date(),
      scannedById: userId,
      result,
    },
    include: {
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
    },
  });

  return serialize({ ...newItem, alreadyScanned: false, isExpected: false });
}

// ---------------------------------------------------------------------------
// 7. updateBulkCount — update counted quantity for a bulk asset item
// ---------------------------------------------------------------------------

export async function updateBulkCount(data: UpdateBulkCountValues) {
  const { organizationId } = await requirePermission("stocktake", "manage");

  const parsed = updateBulkCountSchema.parse(data);

  const item = await prisma.stocktakeItem.findUnique({
    where: { id: parsed.itemId },
    include: { stocktake: true },
  });
  if (!item || item.stocktake.organizationId !== organizationId)
    throw new Error("Item not found");
  if (!item.bulkAssetId) throw new Error("Item is not a bulk asset");

  const result =
    parsed.quantity === item.expectedQuantity
      ? "MATCH"
      : parsed.quantity === 0
        ? "MISSING"
        : "QUANTITY_MISMATCH";

  await prisma.stocktakeItem.update({
    where: { id: parsed.itemId },
    data: {
      found: parsed.quantity > 0,
      foundQuantity: parsed.quantity,
      result,
    },
  });
}

// ---------------------------------------------------------------------------
// 8. completeScanning — transition IN_PROGRESS → REVIEWING
// ---------------------------------------------------------------------------

export async function completeScanning(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "manage",
  );

  const stocktake = await prisma.stocktake.findUnique({
    where: { id, organizationId },
  });
  if (!stocktake) throw new Error("Stocktake not found");
  if (stocktake.status !== "IN_PROGRESS")
    throw new Error("Stocktake must be IN_PROGRESS");

  // Mark all unfound expected items as MISSING
  await prisma.stocktakeItem.updateMany({
    where: {
      stocktakeId: id,
      found: false,
      expectedAtLocation: true,
    },
    data: { result: "MISSING" },
  });

  // Check bulk items for quantity mismatches
  const bulkItems = await prisma.stocktakeItem.findMany({
    where: {
      stocktakeId: id,
      bulkAssetId: { not: null },
      found: true,
    },
  });

  for (const item of bulkItems) {
    if (item.foundQuantity !== item.expectedQuantity) {
      await prisma.stocktakeItem.update({
        where: { id: item.id },
        data: { result: "QUANTITY_MISMATCH" },
      });
    }
  }

  // Compute summary stats
  const items = await prisma.stocktakeItem.findMany({
    where: { stocktakeId: id },
  });

  const foundCount = items.filter((i) => i.found).length;
  const missingCount = items.filter((i) => i.result === "MISSING").length;
  const unexpectedCount = items.filter(
    (i) => i.result === "UNEXPECTED" || i.result === "WRONG_LOCATION",
  ).length;
  const discrepancyCount = items.filter((i) => i.result !== "MATCH").length;

  await prisma.stocktake.update({
    where: { id },
    data: {
      status: "REVIEWING",
      foundCount,
      missingCount,
      unexpectedCount,
      discrepancyCount,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "stocktake",
    entityId: id,
    entityName: stocktake.name,
    summary: `Completed scanning for "${stocktake.name}" — ${foundCount} found, ${missingCount} missing, ${unexpectedCount} unexpected`,
  });
}

// ---------------------------------------------------------------------------
// 8b. resumeScanning — REVIEWING → IN_PROGRESS
// ---------------------------------------------------------------------------

export async function resumeScanning(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "manage",
  );

  const stocktake = await prisma.stocktake.findUnique({
    where: { id, organizationId },
  });
  if (!stocktake) throw new Error("Stocktake not found");
  if (stocktake.status !== "REVIEWING")
    throw new Error("Stocktake must be in REVIEWING status");

  // Reset unresolved MISSING items back to MATCH so they can be re-scanned
  await prisma.stocktakeItem.updateMany({
    where: {
      stocktakeId: id,
      result: "MISSING",
      actionTaken: null,
    },
    data: { result: "MATCH" },
  });

  await prisma.stocktake.update({
    where: { id },
    data: {
      status: "IN_PROGRESS",
      missingCount: 0,
      discrepancyCount: 0,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "stocktake",
    entityId: id,
    entityName: stocktake.name,
    summary: `Resumed scanning for "${stocktake.name}"`,
  });
}

// ---------------------------------------------------------------------------
// 9. resolveDiscrepancy — per-item resolution
// ---------------------------------------------------------------------------

export async function resolveDiscrepancy(data: ResolveDiscrepancyValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "manage",
  );

  const parsed = resolveDiscrepancySchema.parse(data);

  const item = await prisma.stocktakeItem.findUnique({
    where: { id: parsed.itemId },
    include: {
      stocktake: true,
      asset: true,
      bulkAsset: true,
    },
  });
  if (!item || item.stocktake.organizationId !== organizationId)
    throw new Error("Item not found");
  if (item.stocktake.status !== "REVIEWING")
    throw new Error("Stocktake must be in REVIEWING status");

  switch (parsed.action) {
    case "MARK_LOST": {
      if (item.assetId) {
        await prisma.asset.update({
          where: { id: item.assetId },
          data: { status: "LOST" },
        });
      }
      await prisma.stocktakeItem.update({
        where: { id: parsed.itemId },
        data: {
          actionTaken: "Marked as LOST",
          conditionNote: parsed.note,
        },
      });

      await logActivity({
        organizationId,
        userId,
        userName,
        action: "UPDATE",
        entityType: "asset",
        entityId: item.assetId ?? "",
        entityName: item.asset?.assetTag ?? "",
        summary: `Marked as LOST during stocktake "${item.stocktake.name}"`,
      });
      break;
    }

    case "UPDATE_LOCATION": {
      if (item.assetId) {
        await prisma.asset.update({
          where: { id: item.assetId },
          data: { locationId: item.stocktake.locationId },
        });
      }
      if (item.bulkAssetId) {
        await prisma.bulkAsset.update({
          where: { id: item.bulkAssetId },
          data: { locationId: item.stocktake.locationId },
        });
      }
      await prisma.stocktakeItem.update({
        where: { id: parsed.itemId },
        data: {
          actionTaken: "Location updated",
          conditionNote: parsed.note,
        },
      });
      break;
    }

    case "ADJUST_QUANTITY": {
      if (item.bulkAssetId && item.bulkAsset) {
        const diff = item.foundQuantity - item.expectedQuantity;
        await prisma.bulkAsset.update({
          where: { id: item.bulkAssetId },
          data: {
            availableQuantity: {
              increment: diff,
            },
            totalQuantity: {
              increment: diff,
            },
          },
        });
      }
      await prisma.stocktakeItem.update({
        where: { id: parsed.itemId },
        data: {
          actionTaken: `Quantity adjusted (${item.expectedQuantity} → ${item.foundQuantity})`,
          conditionNote: parsed.note,
        },
      });
      break;
    }

    case "IGNORE": {
      await prisma.stocktakeItem.update({
        where: { id: parsed.itemId },
        data: {
          actionTaken: "Ignored",
          conditionNote: parsed.note,
        },
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// 10. bulkResolveDiscrepancies — batch resolve
// ---------------------------------------------------------------------------

export async function bulkResolveDiscrepancies(data: BulkResolveValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "manage",
  );

  const parsed = bulkResolveSchema.parse(data);

  const stocktake = await prisma.stocktake.findUnique({
    where: { id: parsed.stocktakeId, organizationId },
  });
  if (!stocktake) throw new Error("Stocktake not found");
  if (stocktake.status !== "REVIEWING")
    throw new Error("Stocktake must be in REVIEWING status");

  if (parsed.action === "MARK_ALL_MISSING_LOST") {
    const missingItems = await prisma.stocktakeItem.findMany({
      where: {
        stocktakeId: parsed.stocktakeId,
        result: "MISSING",
        actionTaken: null,
        assetId: { not: null },
      },
    });

    const assetIds = missingItems
      .map((i) => i.assetId)
      .filter((id): id is string => id !== null);

    if (assetIds.length > 0) {
      await prisma.asset.updateMany({
        where: { id: { in: assetIds } },
        data: { status: "LOST" },
      });
    }

    await prisma.stocktakeItem.updateMany({
      where: {
        stocktakeId: parsed.stocktakeId,
        result: "MISSING",
        actionTaken: null,
      },
      data: { actionTaken: "Marked as LOST (bulk)" },
    });

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "stocktake",
      entityId: parsed.stocktakeId,
      entityName: stocktake.name,
      summary: `Bulk marked ${assetIds.length} missing items as LOST`,
    });
  }

  if (parsed.action === "IGNORE_ALL_MISSING") {
    await prisma.stocktakeItem.updateMany({
      where: {
        stocktakeId: parsed.stocktakeId,
        result: "MISSING",
        actionTaken: null,
      },
      data: { actionTaken: "Ignored (bulk)" },
    });
  }
}

// ---------------------------------------------------------------------------
// 11. completeStocktake — finalize and apply
// ---------------------------------------------------------------------------

export async function completeStocktake(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "manage",
  );

  const stocktake = await prisma.stocktake.findUnique({
    where: { id, organizationId },
    include: { items: true },
  });
  if (!stocktake) throw new Error("Stocktake not found");
  if (stocktake.status !== "REVIEWING")
    throw new Error("Stocktake must be in REVIEWING status");

  // Recompute final stats
  const items = stocktake.items;
  const foundCount = items.filter((i) => i.found).length;
  const missingCount = items.filter((i) => i.result === "MISSING").length;
  const unexpectedCount = items.filter(
    (i) => i.result === "UNEXPECTED" || i.result === "WRONG_LOCATION",
  ).length;
  const discrepancyCount = items.filter((i) => i.result !== "MATCH").length;

  await prisma.stocktake.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      reviewedById: userId,
      foundCount,
      missingCount,
      unexpectedCount,
      discrepancyCount,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "stocktake",
    entityId: id,
    entityName: stocktake.name,
    summary: `Completed stocktake "${stocktake.name}" — ${foundCount}/${stocktake.expectedCount} found, ${discrepancyCount} discrepancies`,
  });
}

// ---------------------------------------------------------------------------
// 12. cancelStocktake
// ---------------------------------------------------------------------------

export async function cancelStocktake(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "manage",
  );

  const stocktake = await prisma.stocktake.findUnique({
    where: { id, organizationId },
  });
  if (!stocktake) throw new Error("Stocktake not found");
  if (stocktake.status === "COMPLETED")
    throw new Error("Cannot cancel a completed stocktake");

  await prisma.stocktake.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "stocktake",
    entityId: id,
    entityName: stocktake.name,
    summary: `Cancelled stocktake "${stocktake.name}"`,
  });
}

// ---------------------------------------------------------------------------
// 13. getRecentScans — last N scanned items for scanner UI
// ---------------------------------------------------------------------------

export async function getRecentScans(stocktakeId: string, limit = 10) {
  const { organizationId } = await requirePermission("stocktake", "read");

  const stocktake = await prisma.stocktake.findUnique({
    where: { id: stocktakeId, organizationId },
    select: { id: true },
  });
  if (!stocktake) throw new Error("Stocktake not found");

  const items = await prisma.stocktakeItem.findMany({
    where: {
      stocktakeId,
      found: true,
      scannedAt: { not: null },
    },
    include: {
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
    },
    orderBy: { scannedAt: "desc" },
    take: limit,
  });

  return serialize(items);
}

// ---------------------------------------------------------------------------
// 14. searchStocktakeAssets — search expected items by model name, asset tag
// ---------------------------------------------------------------------------

export async function searchStocktakeAssets(
  stocktakeId: string,
  query: string,
) {
  const { organizationId } = await requirePermission("stocktake", "read");

  const stocktake = await prisma.stocktake.findUnique({
    where: { id: stocktakeId, organizationId },
    select: { id: true },
  });
  if (!stocktake) throw new Error("Stocktake not found");

  const search = query.trim();
  if (!search) return serialize([]);

  // Search stocktake items where asset tag or model name matches
  const items = await prisma.stocktakeItem.findMany({
    where: {
      stocktakeId,
      OR: [
        { asset: { assetTag: { contains: search, mode: "insensitive" } } },
        {
          asset: {
            model: { name: { contains: search, mode: "insensitive" } },
          },
        },
        {
          asset: {
            serialNumber: { contains: search, mode: "insensitive" },
          },
        },
        {
          asset: {
            customName: { contains: search, mode: "insensitive" },
          },
        },
        {
          bulkAsset: {
            assetTag: { contains: search, mode: "insensitive" },
          },
        },
        {
          bulkAsset: {
            model: { name: { contains: search, mode: "insensitive" } },
          },
        },
      ],
    },
    include: {
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
    },
    take: 30,
  });

  return serialize(items);
}

// ---------------------------------------------------------------------------
// 15. markStocktakeItemFound — mark an item found by stocktakeItem ID
// ---------------------------------------------------------------------------

export async function markStocktakeItemFound(itemId: string) {
  const { organizationId, userId } = await requirePermission(
    "stocktake",
    "manage",
  );

  const item = await prisma.stocktakeItem.findUnique({
    where: { id: itemId },
    include: {
      stocktake: true,
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
    },
  });
  if (!item || item.stocktake.organizationId !== organizationId)
    throw new Error("Item not found");
  if (item.stocktake.status !== "IN_PROGRESS")
    throw new Error("Stocktake is not in scanning mode");

  const updated = await prisma.stocktakeItem.update({
    where: { id: itemId },
    data: {
      found: true,
      foundQuantity: item.expectedQuantity,
      scannedAt: new Date(),
      scannedById: userId,
      result: "MATCH",
    },
    include: {
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
    },
  });

  return serialize(updated);
}

// ---------------------------------------------------------------------------
// 16. unmarkStocktakeItemFound — undo marking an item as found
// ---------------------------------------------------------------------------

export async function unmarkStocktakeItemFound(itemId: string) {
  const { organizationId } = await requirePermission("stocktake", "manage");

  const item = await prisma.stocktakeItem.findUnique({
    where: { id: itemId },
    include: { stocktake: true },
  });
  if (!item || item.stocktake.organizationId !== organizationId)
    throw new Error("Item not found");
  if (item.stocktake.status !== "IN_PROGRESS")
    throw new Error("Stocktake is not in scanning mode");

  await prisma.stocktakeItem.update({
    where: { id: itemId },
    data: {
      found: false,
      foundQuantity: 0,
      scannedAt: null,
      scannedById: null,
      result: "MATCH",
    },
  });
}
