"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import type { OrgSettings } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { createMaintenanceAssetLinks } from "@/lib/maintenance-record-asset-read";
import {
  getTestTagRecordsByAsset,
  sortRecordsByTestDateDesc,
  getSubTestRecordsByRecordIds,
  getTestProfileMap,
  getUserNameMap,
  type TTRecord,
} from "@/lib/test-tag-read";

/**
 * Re-shape Convex-sourced records into the Prisma `include` form the record-history
 * consumers expect: `testedBy {id,name}` (Better Auth User — Prisma terminus),
 * `testProfile {id,name}` (Convex), and `subTestRecords[]` sorted by `sortOrder`
 * asc (Convex). All cross-domain joins are batched (one round trip each).
 */
async function attachRecordRelations(organizationId: string, records: TTRecord[]) {
  if (records.length === 0) return [];

  const [profileMap, userMap, subTests] = await Promise.all([
    getTestProfileMap(organizationId),
    getUserNameMap(records.map((r) => r.testedById)),
    getSubTestRecordsByRecordIds(records.map((r) => r.id)),
  ]);

  const subsByRecord = new Map<string, typeof subTests>();
  for (const s of subTests) {
    const list = subsByRecord.get(s.testTagRecordId) ?? [];
    list.push(s);
    subsByRecord.set(s.testTagRecordId, list);
  }

  return records.map((r) => ({
    ...r,
    testedBy: { id: r.testedById, name: userMap.get(r.testedById) ?? null },
    testProfile: r.testProfileId ? profileMap.get(r.testProfileId) ?? null : null,
    subTestRecords: (subsByRecord.get(r.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

/**
 * Recalculate and update a TestTagAsset's status in Convex based on its
 * latest test record and dates. Reads from Convex (including newly-written
 * records) — call AFTER all record/asset writes have completed.
 */
async function recalculateStatus(testTagAssetId: string, organizationId: string) {
  const convex = await getConvexClient();
  const asset = await convex.query(api.testTagAssets.getById, { id: testTagAssetId });
  if (!asset) return;
  if (asset.status === "RETIRED") return;

  const allRecords = await convex.query(api.testTagRecords.listByAssetId, {
    testTagAssetId,
  });
  const latestRecord = allRecords.sort((a, b) => (b.testDate ?? 0) - (a.testDate ?? 0))[0];

  if (!latestRecord) {
    await convex.mutation(api.testTagAssets.update, {
      id: testTagAssetId,
      patch: { status: "NOT_YET_TESTED" },
    });
    return;
  }

  if (latestRecord.result === "FAIL") {
    await convex.mutation(api.testTagAssets.update, {
      id: testTagAssetId,
      patch: { status: "FAILED" },
    });
    return;
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  let dueSoonDays = 14;
  if (org?.metadata) {
    try {
      const settings: OrgSettings = JSON.parse(org.metadata);
      dueSoonDays = settings.testTag?.dueSoonThresholdDays || 14;
    } catch { /* ignore */ }
  }

  const now = Date.now();
  const nextDue = asset.nextDueDate ?? null;

  if (!nextDue || nextDue < now) {
    await convex.mutation(api.testTagAssets.update, {
      id: testTagAssetId,
      patch: { status: "OVERDUE" },
    });
  } else {
    const dueSoonMs = dueSoonDays * 24 * 60 * 60 * 1000;
    await convex.mutation(api.testTagAssets.update, {
      id: testTagAssetId,
      patch: { status: nextDue <= now + dueSoonMs ? "DUE_SOON" : "CURRENT" },
    });
  }
}

type SubTestInput = {
  label: string;
  sortOrder: number;
  result: "PASS" | "FAIL";
  earthContinuityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  earthContinuityReading?: number | null;
  insulationResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  insulationReading?: number | null;
  leakageCurrentResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  leakageCurrentReading?: number | null;
  polarityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  notes?: string;
};

export async function createTestTagRecord(data: {
  testTagAssetId: string;
  testProfileId?: string;
  testDate: Date | string;
  testedById?: string; // Session tester — defaults to logged-in user
  testerName: string;
  result: "PASS" | "FAIL";
  visualInspectionResult?: "PASS" | "FAIL";
  visualCordCondition?: boolean;
  visualPlugCondition?: boolean;
  visualHousingCondition?: boolean;
  visualSwitchCondition?: boolean;
  visualVentsUnobstructed?: boolean;
  visualCordGrip?: boolean;
  visualEarthPin?: boolean;
  visualMarkingsLegible?: boolean;
  visualNoModifications?: boolean;
  visualNotes?: string;
  equipmentClassTested?: "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY";
  testMethod?: "INSULATION_RESISTANCE" | "LEAKAGE_CURRENT" | "BOTH";
  earthContinuityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  earthContinuityReading?: number;
  insulationResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  insulationReading?: number;
  insulationTestVoltage?: number;
  leakageCurrentResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  leakageCurrentReading?: number;
  polarityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  rcdTripTimeResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  rcdTripTimeReading?: number;
  functionalTestResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  functionalTestNotes?: string;
  failureAction?: "NONE" | "REPAIRED" | "REMOVED_FROM_SERVICE" | "DISPOSED" | "REFERRED_TO_ELECTRICIAN";
  failureNotes?: string;
  nextDueDate: Date | string;
  subTests?: SubTestInput[];
  outletCount?: number;
}) {
  const { organizationId, userId, userName } = await requirePermission("testTag", "create");

  const convex = await getConvexClient();

  // Verify asset exists and belongs to org (Convex-only now).
  const testTagAsset = await convex.query(api.testTagAssets.getById, { id: data.testTagAssetId });
  if (!testTagAsset || testTagAsset.organizationId !== organizationId) {
    throw new Error("Test tag asset not found");
  }

  // Use the provided tester ID or default to logged-in user
  const testedById = data.testedById || userId;

  // Verify tester is a member of the org if different from logged-in user (auth table stays Prisma).
  if (testedById !== userId) {
    const member = await prisma.member.findFirst({
      where: { userId: testedById, organizationId },
    });
    if (!member) throw new Error("Selected tester is not a member of this organisation");
  }

  const testDate = new Date(data.testDate);
  const nextDueDate = new Date(data.nextDueDate);
  const now = Date.now();
  const recordId = createId();

  // Write the test record to Convex.
  await convex.mutation(api.testTagRecords.createIfMissing, {
    id: recordId,
    organizationId,
    testTagAssetId: data.testTagAssetId,
    testProfileId: data.testProfileId || undefined,
    testDate: testDate.getTime(),
    testedById,
    testerName: data.testerName,
    result: data.result,
    visualInspectionResult: data.visualInspectionResult || "PASS",
    ...(data.visualCordCondition !== undefined && { visualCordCondition: data.visualCordCondition }),
    ...(data.visualPlugCondition !== undefined && { visualPlugCondition: data.visualPlugCondition }),
    ...(data.visualHousingCondition !== undefined && { visualHousingCondition: data.visualHousingCondition }),
    ...(data.visualSwitchCondition !== undefined && { visualSwitchCondition: data.visualSwitchCondition }),
    ...(data.visualVentsUnobstructed !== undefined && { visualVentsUnobstructed: data.visualVentsUnobstructed }),
    ...(data.visualCordGrip !== undefined && { visualCordGrip: data.visualCordGrip }),
    ...(data.visualEarthPin !== undefined && { visualEarthPin: data.visualEarthPin }),
    ...(data.visualMarkingsLegible !== undefined && { visualMarkingsLegible: data.visualMarkingsLegible }),
    ...(data.visualNoModifications !== undefined && { visualNoModifications: data.visualNoModifications }),
    ...(data.visualNotes && { visualNotes: data.visualNotes }),
    equipmentClassTested: data.equipmentClassTested || "CLASS_I",
    testMethod: data.testMethod || "INSULATION_RESISTANCE",
    earthContinuityResult: data.earthContinuityResult || "NOT_APPLICABLE",
    ...(data.earthContinuityReading !== undefined && { earthContinuityReading: data.earthContinuityReading }),
    insulationResult: data.insulationResult || "NOT_APPLICABLE",
    ...(data.insulationReading !== undefined && { insulationReading: data.insulationReading }),
    ...(data.insulationTestVoltage !== undefined && { insulationTestVoltage: data.insulationTestVoltage }),
    leakageCurrentResult: data.leakageCurrentResult || "NOT_APPLICABLE",
    ...(data.leakageCurrentReading !== undefined && { leakageCurrentReading: data.leakageCurrentReading }),
    polarityResult: data.polarityResult || "NOT_APPLICABLE",
    rcdTripTimeResult: data.rcdTripTimeResult || "NOT_APPLICABLE",
    ...(data.rcdTripTimeReading !== undefined && { rcdTripTimeReading: data.rcdTripTimeReading }),
    functionalTestResult: data.functionalTestResult || "NOT_APPLICABLE",
    ...(data.functionalTestNotes && { functionalTestNotes: data.functionalTestNotes }),
    failureAction: data.failureAction || "NONE",
    ...(data.failureNotes && { failureNotes: data.failureNotes }),
    nextDueDate: nextDueDate.getTime(),
    createdAt: now,
    updatedAt: now,
  });

  // Write sub-test records to Convex in ONE array mutation (bulk single-call).
  if (data.subTests && data.subTests.length > 0) {
    await convex.mutation(api.subTestRecords.createManyIfMissing, {
      organizationId,
      records: data.subTests.map((st) => ({
        id: createId(),
        testTagRecordId: recordId,
        label: st.label,
        sortOrder: st.sortOrder,
        result: st.result,
        earthContinuityResult: st.earthContinuityResult || "NOT_APPLICABLE",
        ...(st.earthContinuityReading !== undefined && { earthContinuityReading: st.earthContinuityReading ?? undefined }),
        insulationResult: st.insulationResult || "NOT_APPLICABLE",
        ...(st.insulationReading !== undefined && { insulationReading: st.insulationReading ?? undefined }),
        leakageCurrentResult: st.leakageCurrentResult || "NOT_APPLICABLE",
        ...(st.leakageCurrentReading !== undefined && { leakageCurrentReading: st.leakageCurrentReading ?? undefined }),
        polarityResult: st.polarityResult || "NOT_APPLICABLE",
        ...(st.notes && { notes: st.notes }),
        createdAt: now,
      })),
    });
  }

  // Update parent TestTagAsset scalars in Convex.
  const assetPatch: Record<string, unknown> = {
    lastTestDate: testDate.getTime(),
    nextDueDate: nextDueDate.getTime(),
    updatedAt: now,
  };
  if (data.outletCount) assetPatch.outletCount = data.outletCount;
  if (!testTagAsset.testProfileId && data.testProfileId) assetPatch.testProfileId = data.testProfileId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await convex.mutation(api.testTagAssets.update, { id: data.testTagAssetId, patch: assetPatch as any });

  // Handle failure actions.
  if (data.result === "FAIL") {
    if (data.failureAction === "REMOVED_FROM_SERVICE") {
      await convex.mutation(api.testTagAssets.update, {
        id: data.testTagAssetId,
        patch: { status: "FAILED" },
      });
    } else if (data.failureAction === "DISPOSED") {
      await convex.mutation(api.testTagAssets.update, {
        id: data.testTagAssetId,
        patch: { status: "RETIRED", isActive: false },
      });
    } else if (data.failureAction === "REFERRED_TO_ELECTRICIAN" && testTagAsset.assetId) {
      const maintenanceId = createId();
      const description = data.failureNotes
        ? `Failed test & tag inspection. Notes: ${data.failureNotes}`
        : `Failed test & tag inspection on ${testDate.toLocaleDateString()}. Referred to electrician for repair.`;
      await convex.mutation(api.maintenanceRecords.createIfMissing, {
        id: maintenanceId,
        organizationId,
        type: "REPAIR",
        status: "SCHEDULED",
        title: `Electrician referral — ${testTagAsset.testTagId}`,
        description,
        reportedById: userId,
        createdAt: now,
        updatedAt: now,
      });
      await createMaintenanceAssetLinks(maintenanceId, [testTagAsset.assetId]);
      // Mark the linked asset as in maintenance (asset is Convex-only now).
      await convex.mutation(api.assets.patchAsset, {
        id: testTagAsset.assetId,
        set: { status: "IN_MAINTENANCE", updatedAt: Date.now() },
        clear: [],
      });
    }
  }

  // Recalculate status using the freshly-written Convex state.
  await recalculateStatus(data.testTagAssetId, organizationId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testTagRecord",
    entityId: recordId,
    entityName: testTagAsset.testTagId ?? "",
    summary: `Recorded ${data.result} test for ${testTagAsset.testTagId}`,
    details: { result: data.result, testerName: data.testerName, profileId: data.testProfileId },
  });

  return serialize({ id: recordId });
}

export async function getTestTagRecords(testTagAssetId: string, params?: {
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { page = 1, pageSize = 20 } = params || {};

  // Convex read (testTagRecord is Convex-only). Org scoping is enforced by the
  // composite index; sort + paginate in JS to replicate the old Prisma query.
  const all = sortRecordsByTestDateDesc(
    await getTestTagRecordsByAsset(organizationId, testTagAssetId),
  );
  const total = all.length;
  const pageRecords = all.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const records = await attachRecordRelations(organizationId, pageRecords);

  return serialize({
    records,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

/**
 * Get the latest test record for an asset (used for Quick Pass pre-fill).
 */
export async function getLatestTestRecord(testTagAssetId: string) {
  const { organizationId } = await getOrgContext();

  const all = sortRecordsByTestDateDesc(
    await getTestTagRecordsByAsset(organizationId, testTagAssetId),
  );
  const latest = all[0];
  if (!latest) return null;

  const [record] = await attachRecordRelations(organizationId, [latest]);
  return serialize(record);
}
