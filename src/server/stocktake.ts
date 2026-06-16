"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { syncAssetsToConvex, syncBulkAssetsToConvex } from "@/lib/asset-mirror";
import { syncStocktakeToConvex } from "@/lib/stocktake-mirror";
import { getModelMap, type ConvexModel } from "@/lib/models-read";
import { getLocationMap, getLocationById } from "@/lib/locations-read";
import { getAssetsByOrg, getBulkAssetsByOrg, getAssetByAssetTag, getBulkAssetByAssetTag } from "@/lib/assets-read";
import {
  getStocktakesByOrg,
  getStocktakeByIdConvex,
  getStocktakeItemsConvex,
  attachStocktakeItemAssets,
  type MappedStocktake,
} from "@/lib/stocktake-read";
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

// asset.model + bulkAsset.model live in Convex — grafted onto stocktake items
// from the model map (replaces the nested `asset: { include: { model } }` joins).
type WithModel<A> = A extends null | undefined ? A : A & { model: ConvexModel | null };
async function attachStocktakeModels<T extends { asset?: unknown; bulkAsset?: unknown }>(
  organizationId: string,
  items: T[],
): Promise<Array<Omit<T, "asset" | "bulkAsset"> & { asset: WithModel<T["asset"]>; bulkAsset: WithModel<T["bulkAsset"]> }>> {
  const modelMap = await getModelMap(organizationId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graft = (a: any) =>
    a ? { ...a, model: a.modelId ? modelMap.get(a.modelId) ?? null : null } : a;
  return items.map((it) => ({
    ...it,
    asset: graft((it as { asset?: unknown }).asset),
    bulkAsset: graft((it as { bulkAsset?: unknown }).bulkAsset),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any;
}

// NOTE (security review P0-1): a `syncStocktakeOnLocationChange` server action
// used to live here. It was exported from this `"use server"` module, accepted
// `organizationId` directly from the caller, performed stocktake writes WITHOUT
// any permission/org-context check, and had ZERO in-repo callers — i.e. a dead,
// unauthenticated cross-tenant write endpoint. Removed. If location-change →
// active-stocktake reconciliation is wanted, rebuild it as a NON-exported helper
// (or a lib module) invoked from an already-authenticated server action that
// derives organizationId from the session, never from caller input.

/** Batch-load Better Auth Users by id. `startedBy` / `reviewedBy` are auth rows
 *  and stay Prisma (not a domain-read violation). */
async function getStocktakeUserMap(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map<string, Awaited<ReturnType<typeof prisma.user.findFirst>>>();
  const users = await prisma.user.findMany({ where: { id: { in: unique } } });
  return new Map(users.map((u) => [u.id, u]));
}

/** Comparator for a mapped-stocktake sort field — Date/number/string aware,
 *  nulls last (mirrors Postgres `ORDER BY ... ASC NULLS LAST`). */
function compareStocktake(field: string, dir: "asc" | "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return (ra: MappedStocktake, rb: MappedStocktake) => {
    const av = (ra as unknown as Record<string, unknown>)[field];
    const bv = (rb as unknown as Record<string, unknown>)[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * sign;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  };
}

// StocktakeItemResult sorts by Postgres DECLARED order (not alphabetical).
const STOCKTAKE_RESULT_RANK: Record<string, number> = {
  MATCH: 0,
  MISSING: 1,
  UNEXPECTED: 2,
  QUANTITY_MISMATCH: 3,
  WRONG_LOCATION: 4,
};

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

  // stocktake rows come from Convex; filter / sort / paginate in JS.
  let items = await getStocktakesByOrg(organizationId);
  if (params?.status) items = items.filter((s) => s.status === params.status);
  if (params?.search) {
    const q = params.search.toLowerCase();
    items = items.filter((s) => s.name.toLowerCase().includes(q));
  }
  const sortField = params?.sortField ?? "createdAt";
  const sortDir = params?.sortField ? params.sortDirection ?? "desc" : "desc";
  items = [...items].sort(compareStocktake(sortField, sortDir));

  const total = items.length;
  const pageItems = items.slice(skip, skip + pageSize);

  const [locationMap, userMap] = await Promise.all([
    getLocationMap(organizationId),
    getStocktakeUserMap(pageItems.map((s) => s.startedById)),
  ]);
  const withLocation = pageItems.map((s) => ({
    ...s,
    location: s.locationId ? locationMap.get(s.locationId) ?? null : null,
    startedBy: s.startedById ? userMap.get(s.startedById) ?? null : null,
  }));

  return serialize({ items: withLocation, total, page, pageSize });
}

export async function getStocktakeById(id: string) {
  const { organizationId } = await requirePermission("stocktake", "read");

  // stocktake + items come from Convex; asset/bulkAsset (+ model) attached from
  // the mirrors; location + startedBy/reviewedBy attached below.
  const stocktake = await getStocktakeByIdConvex(id);
  if (!stocktake || stocktake.organizationId !== organizationId) throw new Error("Stocktake not found");

  const rawItems = await getStocktakeItemsConvex(id);
  const items = (await attachStocktakeItemAssets(organizationId, rawItems)).sort(
    (a, b) => (STOCKTAKE_RESULT_RANK[a.result] ?? 99) - (STOCKTAKE_RESULT_RANK[b.result] ?? 99),
  );

  const [locationMap, userMap] = await Promise.all([
    getLocationMap(organizationId),
    getStocktakeUserMap([stocktake.startedById, stocktake.reviewedById]),
  ]);
  return serialize({
    ...stocktake,
    location: stocktake.locationId ? locationMap.get(stocktake.locationId) ?? null : null,
    startedBy: stocktake.startedById ? userMap.get(stocktake.startedById) ?? null : null,
    reviewedBy: stocktake.reviewedById ? userMap.get(stocktake.reviewedById) ?? null : null,
    items,
  });
}

export async function getStocktakeProgress(id: string) {
  const { organizationId } = await requirePermission("stocktake", "read");

  const stocktake = await getStocktakeByIdConvex(id);
  if (!stocktake || stocktake.organizationId !== organizationId) throw new Error("Stocktake not found");
  const items = await getStocktakeItemsConvex(id);

  return serialize({
    expectedCount: stocktake.expectedCount,
    foundCount: items.filter((i) => i.found).length,
    status: stocktake.status,
  });
}

export async function createStocktake(data: CreateStocktakeValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "create",
  );

  const parsed = createStocktakeSchema.parse(data);

  // Verify location belongs to org — lives in Convex.
  const location = await getLocationById(parsed.locationId);
  if (!location || location.organizationId !== organizationId) throw new Error("Location not found");

  // Query expected assets from Convex, filter in JS.
  const [allAssets, allBulkAssets, modelMap] = await Promise.all([
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
    parsed.scope === "CATEGORY" && parsed.categoryId ? getModelMap(organizationId) : Promise.resolve(null),
  ]);

  const assetStatuses = new Set(["AVAILABLE", "IN_MAINTENANCE"]);
  let assets = allAssets.filter(
    (a) => a.locationId === parsed.locationId && assetStatuses.has(a.status ?? "") && a.isActive !== false,
  );
  let bulkAssets = allBulkAssets.filter(
    (b) => b.locationId === parsed.locationId && b.isActive !== false && b.status !== "RETIRED",
  );
  if (parsed.scope === "CATEGORY" && parsed.categoryId && modelMap) {
    assets = assets.filter((a) => modelMap.get(a.modelId)?.categoryId === parsed.categoryId);
    bulkAssets = bulkAssets.filter((b) => modelMap.get(b.modelId)?.categoryId === parsed.categoryId);
  }

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

  await syncStocktakeToConvex(stocktake.id);
  return serialize(stocktake);
}

export async function updateStocktake(id: string, data: UpdateStocktakeValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "update",
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

  // Verify location belongs to org — lives in Convex.
  const location = await getLocationById(parsed.locationId);
  if (!location || location.organizationId !== organizationId) throw new Error("Location not found");

  // Check if location/scope/category changed — need to regenerate items
  const needsRegenerate =
    existing.locationId !== parsed.locationId ||
    existing.scope !== parsed.scope ||
    existing.categoryId !== (parsed.categoryId ?? null);

  if (needsRegenerate) {
    const [allAssets, allBulkAssets, modelMap2] = await Promise.all([
      getAssetsByOrg(organizationId),
      getBulkAssetsByOrg(organizationId),
      parsed.scope === "CATEGORY" && parsed.categoryId ? getModelMap(organizationId) : Promise.resolve(null),
    ]);

    const assetStatuses2 = new Set(["AVAILABLE", "IN_MAINTENANCE"]);
    let assets = allAssets.filter(
      (a) => a.locationId === parsed.locationId && assetStatuses2.has(a.status ?? "") && a.isActive !== false,
    );
    let bulkAssets = allBulkAssets.filter(
      (b) => b.locationId === parsed.locationId && b.isActive !== false && b.status !== "RETIRED",
    );
    if (parsed.scope === "CATEGORY" && parsed.categoryId && modelMap2) {
      assets = assets.filter((a) => modelMap2.get(a.modelId)?.categoryId === parsed.categoryId);
      bulkAssets = bulkAssets.filter((b) => modelMap2.get(b.modelId)?.categoryId === parsed.categoryId);
    }

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

    await syncStocktakeToConvex(stocktake.id);
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

  await syncStocktakeToConvex(stocktake.id);
  return serialize(stocktake);
}

export async function startStocktake(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "update",
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

  await syncStocktakeToConvex(id);
}

export async function scanStocktakeItem(data: ScanItemValues) {
  const { organizationId, userId } = await requirePermission(
    "stocktake",
    "update",
  );

  const parsed = scanItemSchema.parse(data);

  const stocktake = await prisma.stocktake.findUnique({
    where: { id: parsed.stocktakeId, organizationId },
  });
  if (!stocktake) throw new Error("Stocktake not found");
  if (stocktake.status !== "IN_PROGRESS")
    throw new Error("Stocktake is not in scanning mode");

  const tag = parsed.assetTag.trim();

  // Look up asset or bulk asset by tag — lives in Convex.
  const [asset, bulkAsset] = await Promise.all([
    getAssetByAssetTag(organizationId, tag),
    getBulkAssetByAssetTag(organizationId, tag),
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
      asset: true,
      bulkAsset: true,
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
          asset: true,
          bulkAsset: true,
        },
      });
      await syncStocktakeToConvex(parsed.stocktakeId);
      const [grafted] = await attachStocktakeModels(organizationId, [updated]);
      return serialize({
        ...grafted,
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
        asset: true,
        bulkAsset: true,
      },
    });

    await syncStocktakeToConvex(parsed.stocktakeId);
    const [grafted] = await attachStocktakeModels(organizationId, [updated]);
    return serialize({ ...grafted, alreadyScanned: false, isExpected: true });
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
      asset: true,
      bulkAsset: true,
    },
  });

  await syncStocktakeToConvex(parsed.stocktakeId);
  const [grafted] = await attachStocktakeModels(organizationId, [newItem]);
  return serialize({ ...grafted, alreadyScanned: false, isExpected: false });
}

export async function updateBulkCount(data: UpdateBulkCountValues) {
  const { organizationId } = await requirePermission("stocktake", "update");

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

  await syncStocktakeToConvex(item.stocktakeId);
}

export async function completeScanning(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "update",
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

  await syncStocktakeToConvex(id);
}

export async function resumeScanning(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "update",
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

  await syncStocktakeToConvex(id);
}

export async function resolveDiscrepancy(data: ResolveDiscrepancyValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "update",
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

  // Each resolution mutates inventory (asset status / bulk quantity /
  // location) AND stamps the stocktake item's actionTaken. Both writes
  // must commit together — a crash between them would mutate stock while
  // leaving actionTaken null, so a re-run would double-apply the change.
  switch (parsed.action) {
    case "MARK_LOST": {
      await prisma.$transaction(async (tx) => {
        if (item.assetId) {
          await tx.asset.update({
            where: { id: item.assetId },
            data: { status: "LOST" },
          });
        }
        await tx.stocktakeItem.update({
          where: { id: parsed.itemId },
          data: {
            actionTaken: "Marked as LOST",
            conditionNote: parsed.note,
          },
        });
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
      await prisma.$transaction(async (tx) => {
        if (item.assetId) {
          await tx.asset.update({
            where: { id: item.assetId },
            data: { locationId: item.stocktake.locationId },
          });
        }
        if (item.bulkAssetId) {
          await tx.bulkAsset.update({
            where: { id: item.bulkAssetId },
            data: { locationId: item.stocktake.locationId },
          });
        }
        await tx.stocktakeItem.update({
          where: { id: parsed.itemId },
          data: {
            actionTaken: "Location updated",
            conditionNote: parsed.note,
          },
        });
      });
      break;
    }

    case "ADJUST_QUANTITY": {
      await prisma.$transaction(async (tx) => {
        if (item.bulkAssetId && item.bulkAsset) {
          const diff = item.foundQuantity - item.expectedQuantity;
          // diff is negative for a shortfall (counted fewer than expected).
          // Floor both quantities at 0 — bulk_asset has no DB CHECK against
          // negative stock, and a negative quantity corrupts the reorder
          // dashboard's threshold comparison.
          const nextAvailable = Math.max(0, item.bulkAsset.availableQuantity + diff);
          const nextTotal = Math.max(0, item.bulkAsset.totalQuantity + diff);
          await tx.bulkAsset.update({
            where: { id: item.bulkAssetId },
            data: { availableQuantity: nextAvailable, totalQuantity: nextTotal },
          });
        }
        await tx.stocktakeItem.update({
          where: { id: parsed.itemId },
          data: {
            actionTaken: `Quantity adjusted (${item.expectedQuantity} → ${item.foundQuantity})`,
            conditionNote: parsed.note,
          },
        });
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

  // Mirror any asset/bulk status/location/quantity change to Convex (no-op for
  // IGNORE; the helpers skip null ids and re-patch current values idempotently).
  await syncAssetsToConvex([item.assetId]);
  await syncBulkAssetsToConvex([item.bulkAssetId]);
  await syncStocktakeToConvex(item.stocktakeId);
}

export async function bulkResolveDiscrepancies(data: BulkResolveValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "update",
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

    // Mark assets LOST and stamp the items in one transaction. Split,
    // a crash between them leaves assets LOST while the items still show
    // actionTaken: null — a re-run would re-process them (harmless for
    // LOST, but the counts and audit trail would be wrong).
    await prisma.$transaction(async (tx) => {
      if (assetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: assetIds } },
          data: { status: "LOST" },
        });
      }
      await tx.stocktakeItem.updateMany({
        where: {
          stocktakeId: parsed.stocktakeId,
          result: "MISSING",
          actionTaken: null,
        },
        data: { actionTaken: "Marked as LOST (bulk)" },
      });
    });
    // Mirror the assets flipped to LOST.
    await syncAssetsToConvex(assetIds);

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

  await syncStocktakeToConvex(parsed.stocktakeId);
}

export async function completeStocktake(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "update",
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

  await syncStocktakeToConvex(id);
}

export async function cancelStocktake(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "stocktake",
    "update",
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

  await syncStocktakeToConvex(id);
}

export async function getRecentScans(stocktakeId: string, limit = 10) {
  const { organizationId } = await requirePermission("stocktake", "read");

  const stocktake = await getStocktakeByIdConvex(stocktakeId);
  if (!stocktake || stocktake.organizationId !== organizationId) throw new Error("Stocktake not found");

  const found = (await getStocktakeItemsConvex(stocktakeId))
    .filter((i) => i.found && i.scannedAt != null)
    .sort((a, b) => (b.scannedAt?.getTime() ?? 0) - (a.scannedAt?.getTime() ?? 0))
    .slice(0, limit);

  return serialize(await attachStocktakeItemAssets(organizationId, found));
}

export async function searchStocktakeAssets(
  stocktakeId: string,
  query: string,
) {
  const { organizationId } = await requirePermission("stocktake", "read");

  const stocktake = await getStocktakeByIdConvex(stocktakeId);
  if (!stocktake || stocktake.organizationId !== organizationId) throw new Error("Stocktake not found");

  const search = query.trim();
  if (!search) return serialize([]);
  const q = search.toLowerCase();

  // Attach asset/bulkAsset (+ model) from Convex, then filter in JS — replicating
  // the old relational OR (asset tag / serial / customName / model name, bulk tag /
  // model name), case-insensitive.
  const all = await attachStocktakeItemAssets(organizationId, await getStocktakeItemsConvex(stocktakeId));
  const has = (v: string | null | undefined) => !!v && v.toLowerCase().includes(q);
  const items = all
    .filter((it) =>
      has(it.asset?.assetTag) ||
      has(it.asset?.model?.name) ||
      has((it.asset as { serialNumber?: string | null } | null)?.serialNumber) ||
      has((it.asset as { customName?: string | null } | null)?.customName) ||
      has(it.bulkAsset?.assetTag) ||
      has(it.bulkAsset?.model?.name),
    )
    .slice(0, 30);

  return serialize(items);
}

export async function markStocktakeItemFound(itemId: string) {
  const { organizationId, userId } = await requirePermission(
    "stocktake",
    "update",
  );

  const item = await prisma.stocktakeItem.findUnique({
    where: { id: itemId },
    include: {
      stocktake: true,
      asset: true,
      bulkAsset: true,
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
      asset: true,
      bulkAsset: true,
    },
  });

  await syncStocktakeToConvex(item.stocktakeId);
  const [grafted] = await attachStocktakeModels(organizationId, [updated]);
  return serialize(grafted);
}

export async function unmarkStocktakeItemFound(itemId: string) {
  const { organizationId } = await requirePermission("stocktake", "update");

  const item = await prisma.stocktakeItem.findUnique({
    where: { id: itemId },
    include: { stocktake: true },
  });
  if (!item || item.stocktake.organizationId !== organizationId)
    throw new Error("Item not found");
  if (item.stocktake.status !== "IN_PROGRESS")
    throw new Error("Stocktake is not in scanning mode");

  // An UNEXPECTED item (scanned but not on the expected list) must NOT
  // be reset to MATCH on unmark — that produces a phantom row
  // (found:false, expectedAtLocation:false, result:MATCH) which
  // completeScanning ignores entirely, silently dropping it from the
  // discrepancy counts. Preserve UNEXPECTED; only expected-at-location
  // items return to MATCH.
  await prisma.stocktakeItem.update({
    where: { id: itemId },
    data: {
      found: false,
      foundQuantity: 0,
      scannedAt: null,
      scannedById: null,
      result: item.expectedAtLocation ? "MATCH" : item.result,
    },
  });

  await syncStocktakeToConvex(item.stocktakeId);
}
