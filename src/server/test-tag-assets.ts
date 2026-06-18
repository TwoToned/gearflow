"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { reserveTestTagIds, peekNextTestTagIds, getOrgTestTagSettings } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getAssetById, getAssetsByOrg, getBulkAssetById, getBulkAssetsByOrg } from "@/lib/assets-read";
import {
  getTestTagAssetsByOrg,
  getTestTagAssetById,
  getTestTagAssetByTestTagId,
  getTestTagRecordsByOrg,
  getTestTagRecordsByAssetId,
  getSubTestRecordsByRecordIds,
  getTestProfileMap,
  getFullTestProfileById,
  getUserNameMap,
  listAssetMatchesFilters,
  compareTestTagAssets,
} from "@/lib/test-tag-read";
import {
  mirrorTestTagAssetCreate,
  patchTestTagAssetInConvex,
  removeTestTagAssetFromConvex,
  removeTestTagRecordFromConvex,
} from "@/lib/test-tag-mirror";

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

  // Convex reads (org-scoped); compose joins + filter + sort + paginate in JS.
  const [allAssets, allRecords, profileMap, orgAssets, orgBulkAssets] = await Promise.all([
    getTestTagAssetsByOrg(organizationId),
    getTestTagRecordsByOrg(organizationId),
    getTestProfileMap(organizationId),
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
  ]);

  // _count.testRecords per asset (counted in JS from the org record list).
  const recordCounts = new Map<string, number>();
  for (const r of allRecords) {
    recordCounts.set(r.testTagAssetId, (recordCounts.get(r.testTagAssetId) ?? 0) + 1);
  }

  // Asset / bulkAsset join maps (serialized select shape).
  const assetById = new Map(orgAssets.map((a) => [a.id, a]));
  const bulkAssetById = new Map(orgBulkAssets.map((b) => [b.id, b]));

  const filtered = allAssets
    .filter((item) =>
      listAssetMatchesFilters(item, { search, status, equipmentClass, applianceType, assetLinkType, isActive }),
    )
    .sort((a, b) => compareTestTagAssets(a, b, sortBy, sortOrder));

  const total = filtered.length;
  const pageSlice = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const items = pageSlice.map((item) => {
    const linkedAsset = item.assetId ? assetById.get(item.assetId) : null;
    const linkedBulk = item.bulkAssetId ? bulkAssetById.get(item.bulkAssetId) : null;
    return {
      ...item,
      asset: linkedAsset
        ? { id: linkedAsset.id, assetTag: linkedAsset.assetTag, customName: linkedAsset.customName ?? null }
        : null,
      bulkAsset: linkedBulk
        ? { id: linkedBulk.id, assetTag: linkedBulk.assetTag }
        : null,
      testProfile: item.testProfileId ? profileMap.get(item.testProfileId) ?? null : null,
      _count: { testRecords: recordCounts.get(item.id) ?? 0 },
    };
  });

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

  const item = await getTestTagAssetById(id);
  if (!item || item.organizationId !== organizationId) throw new Error("Test tag asset not found");

  // Recent test records (10 most recent by testDate desc) for this asset.
  const allRecords = await getTestTagRecordsByAssetId(id);
  const totalRecords = allRecords.length;
  const recentRecords = [...allRecords]
    .sort((a, b) => b.testDate.getTime() - a.testDate.getTime())
    .slice(0, 10);

  // Sub-test records for those records, grouped by testTagRecordId.
  const subTests = await getSubTestRecordsByRecordIds(recentRecords.map((r) => r.id));
  const subTestsByRecord = new Map<string, typeof subTests>();
  for (const st of subTests) {
    const arr = subTestsByRecord.get(st.testTagRecordId) ?? [];
    arr.push(st);
    subTestsByRecord.set(st.testTagRecordId, arr);
  }

  // testProfile {id,name} per record; testedBy {id,name} (Better Auth User).
  const profileMap = await getTestProfileMap(organizationId);
  const userNameMap = await getUserNameMap(recentRecords.map((r) => r.testedById));

  const testRecords = recentRecords.map((r) => ({
    ...r,
    testProfile: r.testProfileId ? profileMap.get(r.testProfileId) ?? null : null,
    testedBy: { id: r.testedById, name: userNameMap.get(r.testedById) ?? null },
    subTestRecords: subTestsByRecord.get(r.id) ?? [],
  }));

  // Linked serialized / bulk asset, with model attached.
  const [linkedAsset, linkedBulk] = await Promise.all([
    item.assetId ? getAssetById(item.assetId) : Promise.resolve(null),
    item.bulkAssetId ? getBulkAssetById(item.bulkAssetId) : Promise.resolve(null),
  ]);
  const modelMap = await getModelMap(organizationId);

  return serialize({
    ...item,
    asset: linkedAsset
      ? {
          id: linkedAsset.id,
          assetTag: linkedAsset.assetTag,
          customName: linkedAsset.customName ?? null,
          serialNumber: linkedAsset.serialNumber ?? null,
          modelId: linkedAsset.modelId,
          model: modelMap.get(linkedAsset.modelId) ?? null,
        }
      : null,
    bulkAsset: linkedBulk
      ? {
          id: linkedBulk.id,
          assetTag: linkedBulk.assetTag,
          totalQuantity: linkedBulk.totalQuantity ?? null,
          modelId: linkedBulk.modelId,
          model: modelMap.get(linkedBulk.modelId) ?? null,
        }
      : null,
    testProfile: item.testProfileId ? profileMap.get(item.testProfileId) ?? null : null,
    testRecords,
    _count: { testRecords: totalRecords },
  });
}

export async function lookupTestTagAsset(testTagId: string) {
  const { organizationId } = await getOrgContext();

  // Also check retired items so we can block with reactivate option.
  const item = await getTestTagAssetByTestTagId(organizationId, testTagId);
  if (!item) return null;

  // Most-recent test record (1) + its sub-tests + testedBy.
  const allRecords = await getTestTagRecordsByAssetId(item.id);
  const latest = [...allRecords].sort((a, b) => b.testDate.getTime() - a.testDate.getTime()).slice(0, 1);
  const subTests = await getSubTestRecordsByRecordIds(latest.map((r) => r.id));
  const subTestsByRecord = new Map<string, typeof subTests>();
  for (const st of subTests) {
    const arr = subTestsByRecord.get(st.testTagRecordId) ?? [];
    arr.push(st);
    subTestsByRecord.set(st.testTagRecordId, arr);
  }
  const userNameMap = await getUserNameMap(latest.map((r) => r.testedById));
  const testRecords = latest.map((r) => ({
    ...r,
    testedBy: { id: r.testedById, name: userNameMap.get(r.testedById) ?? null },
    subTestRecords: subTestsByRecord.get(r.id) ?? [],
  }));

  // testProfile: full profile (Prisma had `testProfile: true`).
  const testProfile = item.testProfileId ? await getFullTestProfileById(item.testProfileId) : null;

  // Linked serialized asset (with model) + bulk asset.
  const [linkedAsset, linkedBulk] = await Promise.all([
    item.assetId ? getAssetById(item.assetId) : Promise.resolve(null),
    item.bulkAssetId ? getBulkAssetById(item.bulkAssetId) : Promise.resolve(null),
  ]);
  const assetModel = linkedAsset?.modelId ? await getModelById(linkedAsset.modelId) : null;

  return serialize({
    ...item,
    asset: linkedAsset
      ? {
          id: linkedAsset.id,
          assetTag: linkedAsset.assetTag,
          customName: linkedAsset.customName ?? null,
          modelId: linkedAsset.modelId,
          model: assetModel,
        }
      : null,
    bulkAsset: linkedBulk ? { id: linkedBulk.id, assetTag: linkedBulk.assetTag } : null,
    testProfile,
    testRecords,
  });
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
    const linkedAsset = await getAssetById(data.assetId);
    if (linkedAsset && linkedAsset.organizationId === organizationId) testTagId = linkedAsset.assetTag;
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

  await mirrorTestTagAssetCreate(item as unknown as Record<string, unknown>);

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

  // Verify bulk asset exists — lives in Convex.
  const bulkAsset = await getBulkAssetById(data.bulkAssetId);
  if (!bulkAsset || bulkAsset.organizationId !== organizationId) throw new Error("Bulk asset not found");

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

  // Mirror AFTER tx commit (Convex calls cannot run inside a Prisma tx).
  for (const item of items) {
    await mirrorTestTagAssetCreate(item as unknown as Record<string, unknown>);
  }

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

  await patchTestTagAssetInConvex(item.id, item as unknown as Record<string, unknown>);

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

  await patchTestTagAssetInConvex(item.id, item as unknown as Record<string, unknown>);

  return serialize(item);
}

export async function deleteTestTagAsset(id: string) {
  const { organizationId } = await requirePermission("testTag", "delete");

  const existing = await prisma.testTagAsset.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Test tag asset not found");
  if (existing.status !== "RETIRED") throw new Error("Only retired items can be deleted");

  // Capture record ids before deletion so we can mirror the removes.
  const recordsToDelete = await prisma.testTagRecord.findMany({
    where: { testTagAssetId: id, organizationId },
    select: { id: true },
  });

  // Delete all test records first
  await prisma.testTagRecord.deleteMany({
    where: { testTagAssetId: id, organizationId },
  });

  await prisma.testTagAsset.delete({ where: { id, organizationId } });

  // Mirror removes AFTER the Prisma deletes commit.
  for (const r of recordsToDelete) {
    await removeTestTagRecordFromConvex(r.id);
  }
  await removeTestTagAssetFromConvex(id);

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

  // Convex reads (org-scoped); derive counts + lists in JS.
  const [allAssets, allRecords, orgAssets, orgBulkAssets] = await Promise.all([
    getTestTagAssetsByOrg(organizationId),
    getTestTagRecordsByOrg(organizationId),
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
  ]);

  const active = allAssets.filter((a) => a.isActive === true);
  const total = active.length;
  const overdue = active.filter((a) => a.status === "OVERDUE").length;
  const dueSoon = active.filter((a) => a.status === "DUE_SOON").length;
  const current = active.filter((a) => a.status === "CURRENT").length;
  const failed = active.filter((a) => a.status === "FAILED").length;
  const notYetTested = active.filter((a) => a.status === "NOT_YET_TESTED").length;
  // retired counts regardless of isActive (matches Prisma `where: { status: RETIRED }`).
  const retired = allAssets.filter((a) => a.status === "RETIRED").length;

  // Recent tests (20 most recent by testDate desc) + joins.
  const assetByTT = new Map(allAssets.map((a) => [a.id, a]));
  const recentRecords = [...allRecords]
    .sort((a, b) => b.testDate.getTime() - a.testDate.getTime())
    .slice(0, 20);
  const userNameMap = await getUserNameMap(recentRecords.map((r) => r.testedById));
  const recentTests = recentRecords.map((r) => {
    const tt = assetByTT.get(r.testTagAssetId);
    return {
      ...r,
      testTagAsset: tt ? { testTagId: tt.testTagId, description: tt.description } : null,
      testedBy: { id: r.testedById, name: userNameMap.get(r.testedById) ?? null },
    };
  });

  // overdue / due-soon item lists (active, sorted by nextDueDate asc NULLS LAST, take 50).
  const assetById = new Map(orgAssets.map((a) => [a.id, a]));
  const bulkAssetById = new Map(orgBulkAssets.map((b) => [b.id, b]));
  const byNextDueAsc = (a: { nextDueDate: Date | null }, b: { nextDueDate: Date | null }) => {
    if (a.nextDueDate === null && b.nextDueDate === null) return 0;
    if (a.nextDueDate === null) return 1; // NULLS LAST
    if (b.nextDueDate === null) return -1;
    return a.nextDueDate.getTime() - b.nextDueDate.getTime();
  };
  const attachItemLinks = (item: (typeof active)[number]) => {
    const a = item.assetId ? assetById.get(item.assetId) : null;
    const b = item.bulkAssetId ? bulkAssetById.get(item.bulkAssetId) : null;
    return {
      ...item,
      asset: a ? { id: a.id, assetTag: a.assetTag } : null,
      bulkAsset: b ? { id: b.id, assetTag: b.assetTag } : null,
    };
  };
  const overdueItems = active
    .filter((a) => a.status === "OVERDUE")
    .sort(byNextDueAsc)
    .slice(0, 50)
    .map(attachItemLinks);
  const dueSoonItems = active
    .filter((a) => a.status === "DUE_SOON")
    .sort(byNextDueAsc)
    .slice(0, 50)
    .map(attachItemLinks);

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
  // Assets + models live in Convex. testTagAsset still lives in Prisma — get linked assetIds to exclude.
  const [allOrgAssets, modelMap, existingTTAssets] = await Promise.all([
    getAssetsByOrg(organizationId),
    getModelMap(organizationId),
    prisma.testTagAsset.findMany({
      where: { organizationId, isActive: true, assetId: { not: null } },
      select: { assetId: true },
    }),
  ]);
  const linkedAssetIds = new Set(existingTTAssets.map((t) => t.assetId!));
  const unlinkedAssets = allOrgAssets
    .filter((a) => a.isActive !== false && modelMap.get(a.modelId)?.requiresTestAndTag === true && !linkedAssetIds.has(a.id))
    .map((a) => ({ ...a, model: modelMap.get(a.modelId) ?? null }))
    .filter((a): a is typeof a & { model: NonNullable<typeof a["model"]> } => a.model !== null);

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
    // All assets live in Convex — build assetTag set from the org-level list already fetched.
    const existingAssetTags = new Set(allOrgAssets.map((a) => a.assetTag));
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

    // Mirror the retired rows after the updateMany commits.
    const retiredRows = await prisma.testTagAsset.findMany({
      where: { id: { in: retireIds } },
    });
    for (const row of retiredRows) {
      await patchTestTagAssetInConvex(row.id, row as unknown as Record<string, unknown>);
    }
  }

  if (unlinkedAssets.length === 0) return { created: 0, retired };

  const orgTT = await getOrgTestTagSettings();
  const createdItems = await prisma.$transaction(
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

  // Mirror created rows AFTER the tx commits.
  for (const item of createdItems) {
    await mirrorTestTagAssetCreate(item as unknown as Record<string, unknown>);
  }

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

  await patchTestTagAssetInConvex(item.id, item as unknown as Record<string, unknown>);

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
