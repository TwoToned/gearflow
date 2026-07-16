"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct TEST-TAG-ASSET writes (Phase 3 — replaces createTestTagAsset/
 * createTestTagAssetsFromBulk/updateTestTagAsset/retireTestTagAsset/deleteTestTagAsset/
 * reactivateTestTagAsset/backfillTestTagAssets). Each calls the guarded
 * `api.testTagAssetsWrites.*` mutation with the caller-minted id/auditId/now + the
 * verified actor. The test-tag list/detail read one-shot; writes refetch on success.
 */
type CreateInput = {
  testTagId?: string; description: string; equipmentClass?: string; applianceType?: string;
  make?: string; modelName?: string; serialNumber?: string; location?: string;
  testIntervalMonths?: number; testProfileId?: string; outletCount?: number; notes?: string;
  assetId?: string; bulkAssetId?: string;
};
type BulkInput = {
  bulkAssetId: string; count: number; equipmentClass?: string; applianceType?: string;
  testIntervalMonths?: number; description: string; make?: string; modelName?: string; location?: string;
};
type UpdateInput = {
  description?: string; equipmentClass?: string; applianceType?: string; make?: string;
  modelName?: string; serialNumber?: string; location?: string; testIntervalMonths?: number;
  testProfileId?: string | null; outletCount?: number | null; notes?: string;
  assetId?: string | null; bulkAssetId?: string | null;
};
type SubTestInput = {
  label: string; sortOrder: number; result: "PASS" | "FAIL";
  earthContinuityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; earthContinuityReading?: number | null;
  insulationResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; insulationReading?: number | null;
  leakageCurrentResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; leakageCurrentReading?: number | null;
  polarityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; notes?: string;
};
type RecordTestInput = {
  testTagAssetId: string;
  testProfileId?: string;
  testDate: Date | string;
  testedById?: string;
  testerName: string;
  result: "PASS" | "FAIL";
  visualInspectionResult?: "PASS" | "FAIL";
  visualCordCondition?: boolean; visualPlugCondition?: boolean; visualHousingCondition?: boolean;
  visualSwitchCondition?: boolean; visualVentsUnobstructed?: boolean; visualCordGrip?: boolean;
  visualEarthPin?: boolean; visualMarkingsLegible?: boolean; visualNoModifications?: boolean;
  visualNotes?: string;
  equipmentClassTested?: "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY";
  testMethod?: "INSULATION_RESISTANCE" | "LEAKAGE_CURRENT" | "BOTH";
  earthContinuityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; earthContinuityReading?: number;
  insulationResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; insulationReading?: number; insulationTestVoltage?: number;
  leakageCurrentResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; leakageCurrentReading?: number;
  polarityResult?: "PASS" | "FAIL" | "NOT_APPLICABLE";
  rcdTripTimeResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; rcdTripTimeReading?: number;
  functionalTestResult?: "PASS" | "FAIL" | "NOT_APPLICABLE"; functionalTestNotes?: string;
  failureAction?: "NONE" | "REPAIRED" | "REMOVED_FROM_SERVICE" | "DISPOSED" | "REFERRED_TO_ELECTRICIAN";
  failureNotes?: string;
  nextDueDate: Date | string;
  subTests?: SubTestInput[];
  outletCount?: number;
};

export function useTestTagWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.testTagAssetsWrites.createNative);
  const createBulkM = useMutation(api.testTagAssetsWrites.createFromBulkNative);
  const updateM = useMutation(api.testTagAssetsWrites.updateNative);
  const retireM = useMutation(api.testTagAssetsWrites.retireNative);
  const deleteM = useMutation(api.testTagAssetsWrites.deleteNative);
  const reactivateM = useMutation(api.testTagAssetsWrites.reactivateNative);
  const backfillM = useMutation(api.testTagAssetsWrites.backfillNative);
  const recordTestM = useMutation(api.testTagRecordsWrites.createNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => { if (!orgId) throw new Error("No active organization"); return orgId; };

  return {
    create: async (data: CreateInput): Promise<{ id: string; testTagId: string }> => {
      const org = requireOrg();
      // enum fields (equipmentClass/applianceType) are validated at the Convex boundary.
      return await createM({ id: createId(), orgId: org, ...data, now: Date.now(), actor: actor(), auditId: createId() } as Parameters<typeof createM>[0]);
    },
    createFromBulk: async (data: BulkInput): Promise<{ count: number; items: { id: string; testTagId: string }[] }> => {
      const org = requireOrg();
      const { count, ...rest } = data;
      const ids = Array.from({ length: count }, () => createId());
      return await createBulkM({ orgId: org, ids, ...rest, now: Date.now(), actor: actor(), auditId: createId() } as Parameters<typeof createBulkM>[0]);
    },
    update: async (id: string, patch: UpdateInput): Promise<{ id: string }> => {
      const org = requireOrg();
      return await updateM({ id, orgId: org, patch: patch as Parameters<typeof updateM>[0]["patch"], now: Date.now() });
    },
    retire: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await retireM({ id, orgId: org, now: Date.now() });
    },
    remove: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await deleteM({ id, orgId: org });
    },
    reactivate: async (id: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await reactivateM({ id, orgId: org, now: Date.now(), actor: actor(), auditId: createId() });
    },
    backfill: async (): Promise<{ created: number; retired: number }> => {
      const org = requireOrg();
      return await backfillM({ orgId: org, now: Date.now() });
    },
    /**
     * Record a test — the whole T&T state machine (record + sub-tests + asset
     * scalars + failure actions + maintenance referral + status recalc + audit)
     * in ONE atomic native mutation. Mints every id client-side; dates → epoch ms.
     */
    recordTest: async (data: RecordTestInput): Promise<{ id: string }> => {
      const org = requireOrg();
      const { testDate, nextDueDate, subTests, ...rest } = data;
      return await recordTestM({
        orgId: org,
        recordId: createId(),
        ...rest,
        testDate: new Date(testDate).getTime(),
        nextDueDate: new Date(nextDueDate).getTime(),
        subTests: subTests?.map((st) => ({ id: createId(), ...st })),
        maintenanceId: createId(),
        maintenanceLinkId: createId(),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      } as Parameters<typeof recordTestM>[0]);
    },
  };
}
