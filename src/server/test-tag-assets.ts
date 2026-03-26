"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { reserveTestTagIds, peekNextTestTagIds, getOrgTestTagSettings } from "@/server/settings";
import type { Prisma, TestTagStatus } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activity-log";

export async function getTestTagAssets(params?: {
  search?: string;
  status?: string;
  equipmentClass?: string;
  applianceType?: string;
  assetLinkType?: "all" | "serialized" | "bulk" | "standalone";
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();
  const {
    search, status, equipmentClass, applianceType, assetLinkType,
    isActive = true, page = 1, pageSize = 25,
    sortBy = "testTagId", sortOrder = "asc",
  } = params || {};

  const where: Prisma.TestTagAssetWhereInput = {
    organizationId,
    isActive,
    ...(status && { status: status as TestTagStatus }),
    ...(equipmentClass && { equipmentClass: equipmentClass as Prisma.EnumEquipmentClassFilter }),
    ...(applianceType && { applianceType: applianceType as Prisma.EnumApplianceTypeFilter }),
    ...(assetLinkType === "serialized" && { assetId: { not: null } }),
    ...(assetLinkType === "bulk" && { bulkAssetId: { not: null }, assetId: null }),
    ...(assetLinkType === "standalone" && { assetId: null, bulkAssetId: null }),
    ...(search && {
      OR: [
        { testTagId: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        { make: { contains: search, mode: "insensitive" } },
        { modelName: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [items, total] = await Promise.all([
    prisma.testTagAsset.findMany({
      where,
      include: {
        asset: { select: { id: true, assetTag: true, customName: true } },
        bulkAsset: { select: { id: true, assetTag: true } },
        testProfile: { select: { id: true, name: true } },
        _count: { select: { testRecords: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.testTagAsset.count({ where }),
  ]);

  return serialize({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function getTestTagAsset(id: string) {
  const { organizationId } = await getOrgContext();

  const item = await prisma.testTagAsset.findFirst({
    where: { id, organizationId },
    include: {
      asset: {
        select: {
          id: true, assetTag: true, customName: true, serialNumber: true,
          model: { select: { name: true, manufacturer: true, modelNumber: true } },
        },
      },
      bulkAsset: {
        select: {
          id: true, assetTag: true, totalQuantity: true,
          model: { select: { name: true, manufacturer: true } },
        },
      },
      testProfile: { select: { id: true, name: true } },
      testRecords: {
        orderBy: { testDate: "desc" },
        take: 10,
        include: {
          testedBy: { select: { id: true, name: true } },
          testProfile: { select: { id: true, name: true } },
          subTestRecords: { orderBy: { sortOrder: "asc" } },
        },
      },
      _count: { select: { testRecords: true } },
    },
  });

  if (!item) throw new Error("Test tag asset not found");
  return serialize(item);
}

export async function lookupTestTagAsset(testTagId: string) {
  const { organizationId } = await getOrgContext();

  // Also check retired items so we can block with reactivate option
  const item = await prisma.testTagAsset.findFirst({
    where: { organizationId, testTagId },
    include: {
      asset: {
        select: {
          id: true, assetTag: true, customName: true,
          model: { select: { id: true, name: true, defaultTestProfileId: true } },
        },
      },
      bulkAsset: { select: { id: true, assetTag: true } },
      testProfile: true,
      testRecords: {
        orderBy: { testDate: "desc" },
        take: 1,
        include: {
          testedBy: { select: { id: true, name: true } },
          subTestRecords: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  return item ? serialize(item) : null;
}

export async function createTestTagAsset(data: {
  testTagId?: string;
  description: string;
  equipmentClass?: string;
  applianceType?: string;
  make?: string;
  modelName?: string;
  serialNumber?: string;
  location?: string;
  testIntervalMonths?: number;
  testProfileId?: string;
  outletCount?: number;
  notes?: string;
  assetId?: string;
  bulkAssetId?: string;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  // If linking to a serialized asset, use the asset's tag as the test tag ID
  let testTagId = data.testTagId;
  if (data.assetId) {
    const linkedAsset = await prisma.asset.findFirst({
      where: { id: data.assetId, organizationId },
      select: { assetTag: true },
    });
    if (linkedAsset) testTagId = linkedAsset.assetTag;
  }

  // Reserve or use provided test tag ID
  if (!testTagId) {
    const [id] = await reserveTestTagIds(1);
    testTagId = id;
  } else {
    // Check for duplicate
    const existing = await prisma.testTagAsset.findFirst({
      where: { organizationId, testTagId },
    });
    if (existing) throw new Error(`Test tag ID "${testTagId}" already exists`);
  }

  const item = await prisma.testTagAsset.create({
    data: {
      organizationId,
      testTagId,
      description: data.description,
      equipmentClass: (data.equipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
      applianceType: (data.applianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
      make: data.make || null,
      modelName: data.modelName || null,
      serialNumber: data.serialNumber || null,
      location: data.location || null,
      testIntervalMonths: data.testIntervalMonths || 3,
      testProfileId: data.testProfileId || null,
      outletCount: data.outletCount || null,
      notes: data.notes || null,
      assetId: data.assetId || null,
      bulkAssetId: data.bulkAssetId || null,
      status: "NOT_YET_TESTED",
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testTagAsset",
    entityId: item.id,
    entityName: testTagId,
    summary: `Created test tag asset ${testTagId}`,
  });

  return serialize(item);
}

export async function createTestTagAssetsFromBulk(data: {
  bulkAssetId: string;
  count: number;
  equipmentClass?: string;
  applianceType?: string;
  testIntervalMonths?: number;
  description: string;
  make?: string;
  modelName?: string;
  location?: string;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  // Verify bulk asset exists
  const bulkAsset = await prisma.bulkAsset.findFirst({
    where: { id: data.bulkAssetId, organizationId },
  });
  if (!bulkAsset) throw new Error("Bulk asset not found");

  const ids = await reserveTestTagIds(data.count);

  const items = await prisma.$transaction(
    ids.map((testTagId) =>
      prisma.testTagAsset.create({
        data: {
          organizationId,
          testTagId,
          description: data.description,
          equipmentClass: (data.equipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
          applianceType: (data.applianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
          make: data.make || null,
          modelName: data.modelName || null,
          location: data.location || null,
          testIntervalMonths: data.testIntervalMonths || 3,
          bulkAssetId: data.bulkAssetId,
          status: "NOT_YET_TESTED",
        },
      })
    )
  );

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testTagAsset",
    entityId: items[0]?.id || "",
    entityName: `${data.count} test tag assets`,
    summary: `Batch created ${items.length} test tag assets from bulk asset`,
    details: { count: items.length, bulkAssetId: data.bulkAssetId },
  });

  return serialize({ count: items.length, items });
}

export async function updateTestTagAsset(id: string, data: {
  description?: string;
  equipmentClass?: string;
  applianceType?: string;
  make?: string;
  modelName?: string;
  serialNumber?: string;
  location?: string;
  testIntervalMonths?: number;
  testProfileId?: string | null;
  outletCount?: number | null;
  notes?: string;
  assetId?: string | null;
  bulkAssetId?: string | null;
}) {
  const { organizationId } = await requirePermission("testTag", "update");

  const existing = await prisma.testTagAsset.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Test tag asset not found");

  const item = await prisma.testTagAsset.update({
    where: { id, organizationId },
    data: {
      ...(data.description !== undefined && { description: data.description }),
      ...(data.equipmentClass !== undefined && { equipmentClass: data.equipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY" }),
      ...(data.applianceType !== undefined && { applianceType: data.applianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER" }),
      ...(data.make !== undefined && { make: data.make || null }),
      ...(data.modelName !== undefined && { modelName: data.modelName || null }),
      ...(data.serialNumber !== undefined && { serialNumber: data.serialNumber || null }),
      ...(data.location !== undefined && { location: data.location || null }),
      ...(data.testIntervalMonths !== undefined && { testIntervalMonths: data.testIntervalMonths }),
      ...(data.testProfileId !== undefined && { testProfileId: data.testProfileId }),
      ...(data.outletCount !== undefined && { outletCount: data.outletCount }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
      ...(data.assetId !== undefined && { assetId: data.assetId }),
      ...(data.bulkAssetId !== undefined && { bulkAssetId: data.bulkAssetId }),
    },
  });

  return serialize(item);
}

export async function retireTestTagAsset(id: string) {
  const { organizationId } = await requirePermission("testTag", "update");

  const existing = await prisma.testTagAsset.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Test tag asset not found");

  const item = await prisma.testTagAsset.update({
    where: { id, organizationId },
    data: { status: "RETIRED", isActive: false },
  });

  return serialize(item);
}

export async function deleteTestTagAsset(id: string) {
  const { organizationId } = await requirePermission("testTag", "delete");

  const existing = await prisma.testTagAsset.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Test tag asset not found");
  if (existing.status !== "RETIRED") throw new Error("Only retired items can be deleted");

  // Delete all test records first
  await prisma.testTagRecord.deleteMany({
    where: { testTagAssetId: id, organizationId },
  });

  await prisma.testTagAsset.delete({ where: { id, organizationId } });
  return { id };
}

export async function getTestTagDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  // Get org settings for dueSoonThreshold
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  let dueSoonDays = 14;
  if (org?.metadata) {
    try {
      const settings = JSON.parse(org.metadata);
      dueSoonDays = settings.testTag?.dueSoonThresholdDays || 14;
    } catch { /* ignore */ }
  }

  const dueSoonDate = new Date(now);
  dueSoonDate.setDate(dueSoonDate.getDate() + dueSoonDays);

  const [total, overdue, dueSoon, current, failed, notYetTested, retired, recentTests, overdueItems, dueSoonItems] = await Promise.all([
    prisma.testTagAsset.count({ where: { organizationId, isActive: true } }),
    prisma.testTagAsset.count({ where: { organizationId, isActive: true, status: "OVERDUE" } }),
    prisma.testTagAsset.count({ where: { organizationId, isActive: true, status: "DUE_SOON" } }),
    prisma.testTagAsset.count({ where: { organizationId, isActive: true, status: "CURRENT" } }),
    prisma.testTagAsset.count({ where: { organizationId, isActive: true, status: "FAILED" } }),
    prisma.testTagAsset.count({ where: { organizationId, isActive: true, status: "NOT_YET_TESTED" } }),
    prisma.testTagAsset.count({ where: { organizationId, status: "RETIRED" } }),
    prisma.testTagRecord.findMany({
      where: { organizationId },
      orderBy: { testDate: "desc" },
      take: 20,
      include: {
        testTagAsset: { select: { testTagId: true, description: true } },
        testedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.testTagAsset.findMany({
      where: { organizationId, isActive: true, status: "OVERDUE" },
      orderBy: { nextDueDate: "asc" },
      take: 50,
      include: {
        asset: { select: { id: true, assetTag: true } },
        bulkAsset: { select: { id: true, assetTag: true } },
      },
    }),
    prisma.testTagAsset.findMany({
      where: { organizationId, isActive: true, status: "DUE_SOON" },
      orderBy: { nextDueDate: "asc" },
      take: 50,
      include: {
        asset: { select: { id: true, assetTag: true } },
        bulkAsset: { select: { id: true, assetTag: true } },
      },
    }),
  ]);

  return serialize({
    total, overdue, dueSoon, current, failed, notYetTested, retired,
    recentTests, overdueItems, dueSoonItems,
  });
}

/**
 * Auto-register all serialized assets whose model requires T&T
 * but that don't yet have a linked TestTagAsset.
 */
export async function backfillTestTagAssets() {
  const { organizationId } = await getOrgContext();

  // Find all active serialized assets whose model requires T&T and that have no linked TestTagAsset
  const unlinkedAssets = await prisma.asset.findMany({
    where: {
      organizationId,
      isActive: true,
      model: { requiresTestAndTag: true },
      testTagAsset: null,
    },
    include: {
      model: { select: { name: true, manufacturer: true, modelNumber: true, testAndTagIntervalDays: true, defaultEquipmentClass: true, defaultApplianceType: true, defaultTestProfileId: true } },
    },
  });

  // Retire any active T&T entries whose linked asset no longer exists or is inactive
  const orphaned = await prisma.testTagAsset.findMany({
    where: {
      organizationId,
      isActive: true,
      assetId: { not: null },
      asset: { OR: [{ isActive: false }, { id: undefined }] },
    },
    select: { id: true },
  });

  // Also find entries where the asset was deleted (assetId set but relation is null due to onDelete: SetNull)
  const danglingEntries = await prisma.testTagAsset.findMany({
    where: {
      organizationId,
      isActive: true,
      assetId: null,
      // These had an asset link but it was severed — they have no asset and no bulk asset (standalone items are fine)
      bulkAssetId: null,
      // Only retire ones that were auto-created from assets (testTagId matches an asset tag pattern)
      // Use a simpler heuristic: if description contains parenthesized asset tag, it was auto-created
    },
  });

  // Filter dangling entries: only retire those whose testTagId doesn't belong to any existing asset
  const danglingToRetire: string[] = [];
  if (danglingEntries.length > 0) {
    const existingAssetTags = new Set(
      (await prisma.asset.findMany({
        where: { organizationId, assetTag: { in: danglingEntries.map((e) => e.testTagId) } },
        select: { assetTag: true },
      })).map((a) => a.assetTag)
    );
    for (const entry of danglingEntries) {
      if (!existingAssetTags.has(entry.testTagId)) {
        danglingToRetire.push(entry.id);
      }
    }
  }

  const retireIds = [...orphaned.map((o) => o.id), ...danglingToRetire];
  let retired = 0;
  if (retireIds.length > 0) {
    const result = await prisma.testTagAsset.updateMany({
      where: { id: { in: retireIds } },
      data: { status: "RETIRED", isActive: false },
    });
    retired = result.count;
  }

  if (unlinkedAssets.length === 0) return { created: 0, retired };

  const orgTT = await getOrgTestTagSettings();
  await prisma.$transaction(
    unlinkedAssets.map((asset) => {
      const intervalMonths = asset.model.testAndTagIntervalDays
        ? Math.max(1, Math.round(asset.model.testAndTagIntervalDays / 30))
        : (orgTT.defaultIntervalMonths || 3);
      return prisma.testTagAsset.create({
        data: {
          organizationId,
          testTagId: asset.assetTag,
          description: `${asset.model.manufacturer ? asset.model.manufacturer + " " : ""}${asset.model.name} (${asset.assetTag})`,
          equipmentClass: asset.model.defaultEquipmentClass || "CLASS_I",
          applianceType: asset.model.defaultApplianceType || "APPLIANCE",
          make: asset.model.manufacturer || null,
          modelName: asset.model.modelNumber || null,
          serialNumber: asset.serialNumber || null,
          testIntervalMonths: intervalMonths,
          testProfileId: asset.model.defaultTestProfileId || null,
          status: "NOT_YET_TESTED",
          assetId: asset.id,
        },
      });
    })
  );

  return { created: unlinkedAssets.length, retired };
}

export async function reactivateTestTagAsset(id: string) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "update");

  const existing = await prisma.testTagAsset.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Test tag asset not found");
  if (existing.status !== "RETIRED") throw new Error("Only retired items can be reactivated");

  const item = await prisma.testTagAsset.update({
    where: { id, organizationId },
    data: { status: "NOT_YET_TESTED", isActive: true },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "testTagAsset",
    entityId: item.id,
    entityName: item.testTagId,
    summary: `Reactivated test tag asset ${item.testTagId}`,
  });

  return serialize(item);
}

export { peekNextTestTagIds };
