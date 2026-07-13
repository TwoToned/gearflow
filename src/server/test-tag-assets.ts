"use server";

import { createId } from "@paralleldrive/cuid2";
import { readOrgSettingsBlob } from "@/lib/org-settings-read";
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
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

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
    // Check for duplicate in Convex.
    const existing = await getTestTagAssetByTestTagId(organizationId, testTagId);
    if (existing) throw new Error(`Test tag ID "${testTagId}" already exists`);
  }

  const convex = await getConvexClient();
  const id = createId();
  const now = Date.now();

  await convex.mutation(api.testTagAssets.createIfMissing, {
    id,
    organizationId,
    testTagId,
    description: data.description,
    equipmentClass: (data.equipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
    applianceType: (data.applianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
    ...(data.make && { make: data.make }),
    ...(data.modelName && { modelName: data.modelName }),
    ...(data.serialNumber && { serialNumber: data.serialNumber }),
    ...(data.location && { location: data.location }),
    testIntervalMonths: data.testIntervalMonths || 3,
    ...(data.testProfileId && { testProfileId: data.testProfileId }),
    ...(data.outletCount && { outletCount: data.outletCount }),
    ...(data.notes && { notes: data.notes }),
    ...(data.assetId && { assetId: data.assetId }),
    ...(data.bulkAssetId && { bulkAssetId: data.bulkAssetId }),
    status: "NOT_YET_TESTED",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testTagAsset",
    entityId: id,
    entityName: testTagId,
    summary: `Created test tag asset ${testTagId}`,
  });

  return serialize({ id, testTagId, organizationId, status: "NOT_YET_TESTED" });
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
  const convex = await getConvexClient();
  const now = Date.now();

  const createdIds: string[] = [];
  for (const testTagId of ids) {
    const id = createId();
    await convex.mutation(api.testTagAssets.createIfMissing, {
      id,
      organizationId,
      testTagId,
      description: data.description,
      equipmentClass: (data.equipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
      applianceType: (data.applianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
      ...(data.make && { make: data.make }),
      ...(data.modelName && { modelName: data.modelName }),
      ...(data.location && { location: data.location }),
      testIntervalMonths: data.testIntervalMonths || 3,
      bulkAssetId: data.bulkAssetId,
      status: "NOT_YET_TESTED",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    createdIds.push(id);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testTagAsset",
    entityId: createdIds[0] || "",
    entityName: `${data.count} test tag assets`,
    summary: `Batch created ${createdIds.length} test tag assets from bulk asset`,
    details: { count: createdIds.length, bulkAssetId: data.bulkAssetId },
  });

  return serialize({ count: createdIds.length, items: createdIds.map((id, i) => ({ id, testTagId: ids[i] })) });
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

  const convex = await getConvexClient();
  const existing = await convex.query(api.testTagAssets.getById, { id });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Test tag asset not found");

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (data.description !== undefined) patch.description = data.description;
  if (data.equipmentClass !== undefined) patch.equipmentClass = data.equipmentClass;
  if (data.applianceType !== undefined) patch.applianceType = data.applianceType;
  if (data.make !== undefined) patch.make = data.make || undefined;
  if (data.modelName !== undefined) patch.modelName = data.modelName || undefined;
  if (data.serialNumber !== undefined) patch.serialNumber = data.serialNumber || undefined;
  if (data.location !== undefined) patch.location = data.location || undefined;
  if (data.testIntervalMonths !== undefined) patch.testIntervalMonths = data.testIntervalMonths;
  if (data.testProfileId !== undefined) patch.testProfileId = data.testProfileId || undefined;
  if (data.outletCount !== undefined) patch.outletCount = data.outletCount || undefined;
  if (data.notes !== undefined) patch.notes = data.notes || undefined;
  if (data.assetId !== undefined) patch.assetId = data.assetId || undefined;
  if (data.bulkAssetId !== undefined) patch.bulkAssetId = data.bulkAssetId || undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await convex.mutation(api.testTagAssets.update, { id, patch: patch as any });

  return serialize({ id, ...patch });
}

export async function retireTestTagAsset(id: string) {
  const { organizationId } = await requirePermission("testTag", "update");

  const convex = await getConvexClient();
  const existing = await convex.query(api.testTagAssets.getById, { id });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Test tag asset not found");

  await convex.mutation(api.testTagAssets.update, {
    id,
    patch: { status: "RETIRED", isActive: false, updatedAt: Date.now() },
  });

  return serialize({ id, status: "RETIRED", isActive: false });
}

export async function deleteTestTagAsset(id: string) {
  const { organizationId } = await requirePermission("testTag", "delete");

  const convex = await getConvexClient();
  const existing = await convex.query(api.testTagAssets.getById, { id });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Test tag asset not found");
  if (existing.status !== "RETIRED") throw new Error("Only retired items can be deleted");

  // Get all test records for this asset so we can delete them from Convex.
  const records = await convex.query(api.testTagRecords.listByAssetId, { testTagAssetId: id });

  // Delete all test records and their sub-tests from Convex.
  for (const record of records) {
    const subTests = await convex.query(api.subTestRecords.list, { testTagRecordId: record.id });
    for (const st of subTests) {
      await convex.mutation(api.subTestRecords.remove, { id: st.id });
    }
    await convex.mutation(api.testTagRecords.remove, { id: record.id });
  }

  await convex.mutation(api.testTagAssets.remove, { id });

  return { id };
}

export async function getTestTagDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  // Get org settings for dueSoonThreshold (Convex org-settings blob).
  const settings = await readOrgSettingsBlob(organizationId);
  const dueSoonDays = settings.testTag?.dueSoonThresholdDays || 14;

  const dueSoonDate = new Date(now);
  dueSoonDate.setDate(dueSoonDate.getDate() + dueSoonDays);

  // Convex reads (org-scoped); derive counts + lists in JS.
  const [allAssets, allRecordsList, orgAssets, orgBulkAssets] = await Promise.all([
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
  const recentRecords = [...allRecordsList]
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

  const convex = await getConvexClient();

  // All data from Convex (assets + T&T assets + models).
  const [allOrgAssets, modelMap, allTTAssets] = await Promise.all([
    getAssetsByOrg(organizationId),
    getModelMap(organizationId),
    getTestTagAssetsByOrg(organizationId),
  ]);

  const assetById = new Map(allOrgAssets.map((a) => [a.id, a]));

  // T&T assets already linked to a serialized asset (active only).
  const linkedAssetIds = new Set(
    allTTAssets.filter((t) => t.isActive !== false && t.assetId).map((t) => t.assetId!),
  );

  // Assets that need T&T but don't have a linked entry yet.
  const unlinkedAssets = allOrgAssets
    .filter((a) => a.isActive !== false && modelMap.get(a.modelId)?.requiresTestAndTag === true && !linkedAssetIds.has(a.id))
    .map((a) => ({ ...a, model: modelMap.get(a.modelId) ?? null }))
    .filter((a): a is typeof a & { model: NonNullable<typeof a["model"]> } => a.model !== null);

  // Orphaned: active T&T entries whose linked asset is gone or inactive.
  const orphaned = allTTAssets.filter((t) => {
    if (t.isActive === false || !t.assetId) return false;
    const asset = assetById.get(t.assetId);
    return !asset || asset.isActive === false;
  });

  // Dangling: active T&T entries with no asset/bulk link whose testTagId
  // doesn't match any existing asset tag (auto-created orphans).
  const existingAssetTags = new Set(allOrgAssets.map((a) => a.assetTag));
  const dangling = allTTAssets.filter(
    (t) => t.isActive !== false && !t.assetId && !t.bulkAssetId && !existingAssetTags.has(t.testTagId),
  );

  const retireIds = [...new Set([...orphaned.map((o) => o.id), ...dangling.map((d) => d.id)])];
  let retired = 0;
  const now = Date.now();
  for (const retireId of retireIds) {
    await convex.mutation(api.testTagAssets.update, {
      id: retireId,
      patch: { status: "RETIRED", isActive: false, updatedAt: now },
    });
    retired++;
  }

  if (unlinkedAssets.length === 0) return { created: 0, retired };

  const orgTT = await getOrgTestTagSettings();
  let created = 0;
  for (const asset of unlinkedAssets) {
    const intervalMonths = asset.model.testAndTagIntervalDays
      ? Math.max(1, Math.round(asset.model.testAndTagIntervalDays / 30))
      : (orgTT.defaultIntervalMonths || 3);
    await convex.mutation(api.testTagAssets.createIfMissing, {
      id: createId(),
      organizationId,
      testTagId: asset.assetTag,
      description: `${asset.model.manufacturer ? asset.model.manufacturer + " " : ""}${asset.model.name} (${asset.assetTag})`,
      equipmentClass: (asset.model.defaultEquipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
      applianceType: (asset.model.defaultApplianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
      ...(asset.model.manufacturer && { make: asset.model.manufacturer }),
      ...(asset.model.modelNumber && { modelName: asset.model.modelNumber }),
      ...(asset.serialNumber && { serialNumber: asset.serialNumber }),
      testIntervalMonths: intervalMonths,
      ...(asset.model.defaultTestProfileId && { testProfileId: asset.model.defaultTestProfileId }),
      status: "NOT_YET_TESTED",
      assetId: asset.id,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }

  return { created, retired };
}

export async function reactivateTestTagAsset(id: string) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "update");

  const convex = await getConvexClient();
  const existing = await convex.query(api.testTagAssets.getById, { id });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Test tag asset not found");
  if (existing.status !== "RETIRED") throw new Error("Only retired items can be reactivated");

  await convex.mutation(api.testTagAssets.update, {
    id,
    patch: { status: "NOT_YET_TESTED", isActive: true, updatedAt: Date.now() },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "testTagAsset",
    entityId: id,
    entityName: existing.testTagId,
    summary: `Reactivated test tag asset ${existing.testTagId}`,
  });

  return serialize({ id, status: "NOT_YET_TESTED", isActive: true });
}

export { peekNextTestTagIds };
