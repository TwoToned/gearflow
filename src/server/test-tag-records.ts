"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import type { OrgSettings } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import { syncAssetsToConvex } from "@/lib/asset-mirror";
import {
  mirrorTestTagRecordCreate,
  mirrorSubTestRecordCreate,
  patchTestTagAssetInConvex,
} from "@/lib/test-tag-mirror";
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
 * Recalculate and update a TestTagAsset's status based on its latest test record and dates.
 */
async function recalculateStatus(
  testTagAssetId: string,
  organizationId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] = prisma,
) {
  const asset = await tx.testTagAsset.findFirst({
    where: { id: testTagAssetId, organizationId },
    include: {
      testRecords: { orderBy: { testDate: "desc" }, take: 1 },
    },
  });
  if (!asset) return;

  // Retired items stay retired
  if (asset.status === "RETIRED") return;

  const latestRecord = asset.testRecords[0];

  if (!latestRecord) {
    await tx.testTagAsset.update({
      where: { id: testTagAssetId },
      data: { status: "NOT_YET_TESTED" },
    });
    return;
  }

  // If latest test failed, status is FAILED
  if (latestRecord.result === "FAIL") {
    await tx.testTagAsset.update({
      where: { id: testTagAssetId },
      data: { status: "FAILED" },
    });
    return;
  }

  // Determine due soon threshold
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
  });
  let dueSoonDays = 14;
  if (org?.metadata) {
    try {
      const settings: OrgSettings = JSON.parse(org.metadata);
      dueSoonDays = settings.testTag?.dueSoonThresholdDays || 14;
    } catch { /* ignore */ }
  }

  const now = new Date();
  const nextDue = asset.nextDueDate;

  if (!nextDue || nextDue < now) {
    await tx.testTagAsset.update({
      where: { id: testTagAssetId },
      data: { status: "OVERDUE" },
    });
  } else {
    const dueSoonDate = new Date(now);
    dueSoonDate.setDate(dueSoonDate.getDate() + dueSoonDays);

    await tx.testTagAsset.update({
      where: { id: testTagAssetId },
      data: { status: nextDue <= dueSoonDate ? "DUE_SOON" : "CURRENT" },
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

  // Verify asset exists and belongs to org
  const testTagAsset = await prisma.testTagAsset.findFirst({
    where: { id: data.testTagAssetId, organizationId },
  });
  if (!testTagAsset) throw new Error("Test tag asset not found");

  // Use the provided tester ID or default to logged-in user
  const testedById = data.testedById || userId;

  // Verify tester is a member of the org if different from logged-in user
  if (testedById !== userId) {
    const member = await prisma.member.findFirst({
      where: { userId: testedById, organizationId },
    });
    if (!member) throw new Error("Selected tester is not a member of this organisation");
  }

  const testDate = new Date(data.testDate);
  const nextDueDate = new Date(data.nextDueDate);

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.testTagRecord.create({
      data: {
        organizationId,
        testTagAssetId: data.testTagAssetId,
        testProfileId: data.testProfileId || null,
        testDate,
        testedById,
        testerName: data.testerName,
        result: data.result,
        visualInspectionResult: data.visualInspectionResult || "PASS",
        visualCordCondition: data.visualCordCondition ?? null,
        visualPlugCondition: data.visualPlugCondition ?? null,
        visualHousingCondition: data.visualHousingCondition ?? null,
        visualSwitchCondition: data.visualSwitchCondition ?? null,
        visualVentsUnobstructed: data.visualVentsUnobstructed ?? null,
        visualCordGrip: data.visualCordGrip ?? null,
        visualEarthPin: data.visualEarthPin ?? null,
        visualMarkingsLegible: data.visualMarkingsLegible ?? null,
        visualNoModifications: data.visualNoModifications ?? null,
        visualNotes: data.visualNotes || null,
        equipmentClassTested: data.equipmentClassTested || "CLASS_I",
        testMethod: data.testMethod || "INSULATION_RESISTANCE",
        earthContinuityResult: data.earthContinuityResult || "NOT_APPLICABLE",
        earthContinuityReading: data.earthContinuityReading ?? null,
        insulationResult: data.insulationResult || "NOT_APPLICABLE",
        insulationReading: data.insulationReading ?? null,
        insulationTestVoltage: data.insulationTestVoltage ?? null,
        leakageCurrentResult: data.leakageCurrentResult || "NOT_APPLICABLE",
        leakageCurrentReading: data.leakageCurrentReading ?? null,
        polarityResult: data.polarityResult || "NOT_APPLICABLE",
        rcdTripTimeResult: data.rcdTripTimeResult || "NOT_APPLICABLE",
        rcdTripTimeReading: data.rcdTripTimeReading ?? null,
        functionalTestResult: data.functionalTestResult || "NOT_APPLICABLE",
        functionalTestNotes: data.functionalTestNotes || null,
        failureAction: data.failureAction || "NONE",
        failureNotes: data.failureNotes || null,
        nextDueDate,
      },
    });

    // Create sub-test records if provided
    if (data.subTests && data.subTests.length > 0) {
      await tx.subTestRecord.createMany({
        data: data.subTests.map(st => ({
          testTagRecordId: created.id,
          label: st.label,
          sortOrder: st.sortOrder,
          result: st.result,
          earthContinuityResult: st.earthContinuityResult || "NOT_APPLICABLE",
          earthContinuityReading: st.earthContinuityReading ?? null,
          insulationResult: st.insulationResult || "NOT_APPLICABLE",
          insulationReading: st.insulationReading ?? null,
          leakageCurrentResult: st.leakageCurrentResult || "NOT_APPLICABLE",
          leakageCurrentReading: st.leakageCurrentReading ?? null,
          polarityResult: st.polarityResult || "NOT_APPLICABLE",
          notes: st.notes || null,
        })),
      });
    }

    // Update parent TestTagAsset
    await tx.testTagAsset.update({
      where: { id: data.testTagAssetId },
      data: {
        lastTestDate: testDate,
        nextDueDate,
        // Remember outlet count for next time
        ...(data.outletCount && { outletCount: data.outletCount }),
        // Assign profile to asset if not already set
        ...(!testTagAsset.testProfileId && data.testProfileId && { testProfileId: data.testProfileId }),
      },
    });

    // Handle failure actions: mark asset out of service, retired, or create maintenance record
    if (data.result === "FAIL") {
      if (data.failureAction === "REMOVED_FROM_SERVICE") {
        await tx.testTagAsset.update({
          where: { id: data.testTagAssetId },
          data: { status: "FAILED" },
        });
      } else if (data.failureAction === "DISPOSED") {
        await tx.testTagAsset.update({
          where: { id: data.testTagAssetId },
          data: { status: "RETIRED", isActive: false },
        });
      } else if (data.failureAction === "REFERRED_TO_ELECTRICIAN" && testTagAsset.assetId) {
        // Create a maintenance record for the linked asset
        await tx.maintenanceRecord.create({
          data: {
            organizationId,
            type: "REPAIR",
            status: "SCHEDULED",
            title: `Electrician referral — ${testTagAsset.testTagId}`,
            description: data.failureNotes
              ? `Failed test & tag inspection. Notes: ${data.failureNotes}`
              : `Failed test & tag inspection on ${testDate.toLocaleDateString()}. Referred to electrician for repair.`,
            reportedById: userId,
            assets: { create: [{ assetId: testTagAsset.assetId }] },
          },
        });
        // Mark the linked asset as in maintenance
        await tx.asset.update({
          where: { id: testTagAsset.assetId },
          data: { status: "IN_MAINTENANCE" },
        });
      }
    }

    // Recalculate status (handles PASS cases and FAIL without explicit action)
    await recalculateStatus(data.testTagAssetId, organizationId, tx);

    return created;
  });

  // Mirror to Convex AFTER the tx commits (Convex calls cannot run inside a Prisma tx).
  // Re-read the final state so the mirror reflects all in-tx mutations.
  const [finalRecord, finalAsset, subRecords] = await Promise.all([
    prisma.testTagRecord.findUnique({ where: { id: record.id } }),
    prisma.testTagAsset.findUnique({ where: { id: data.testTagAssetId } }),
    prisma.subTestRecord.findMany({ where: { testTagRecordId: record.id } }),
  ]);
  if (finalRecord) {
    await mirrorTestTagRecordCreate(finalRecord as unknown as Record<string, unknown>);
  }
  for (const st of subRecords) {
    await mirrorSubTestRecordCreate(st as unknown as Record<string, unknown>);
  }
  if (finalAsset) {
    await patchTestTagAssetInConvex(
      finalAsset.id,
      finalAsset as unknown as Record<string, unknown>,
    );
  }

  // A FAIL referral may have flipped the linked asset to IN_MAINTENANCE — mirror it.
  if (testTagAsset.assetId) await syncAssetsToConvex([testTagAsset.assetId]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "testTagRecord",
    entityId: record.id,
    entityName: testTagAsset.testTagId,
    summary: `Recorded ${data.result} test for ${testTagAsset.testTagId}`,
    details: { result: data.result, testerName: data.testerName, profileId: data.testProfileId },
  });

  return serialize(record);
}

export async function getTestTagRecords(testTagAssetId: string, params?: {
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { page = 1, pageSize = 20 } = params || {};

  // Convex read (testTagRecord is dual-written). Org scoping is enforced by the
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
