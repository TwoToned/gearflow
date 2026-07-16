"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import type { CheckRecordFormValues } from "@/lib/validations/check-item";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct CHECK-RECORD writes (Phase 3 — replaces the 7 composite writes in
 * src/server/check-records.ts). Each method calls the guarded
 * `api.checkRecordWrites.*` mutation, which folds the check-record insert + the
 * line/unit state transition + inline predictive maintenance into ONE atomic Convex
 * mutation. The client mints every id: one recordId per submitted check, and one
 * maintenance triple (maintenanceId / maintenanceLinkId / auditId) per DISTINCT
 * FAILED check item id (the predictive-maintenance plan). Dates → epoch ms.
 *
 * Signatures mirror the deleted server actions so the warehouse + check page rewires
 * are minimal.
 */

type Check = CheckRecordFormValues;
type Context = "PREP" | "RETURN";

/** Each submitted check + a fresh client-minted record id. */
function buildChecks(checks: Check[]) {
  return checks.map((c) => ({
    recordId: createId(),
    checkItemId: c.checkItemId,
    result: c.result,
    ...(c.value ? { value: c.value } : {}),
    ...(c.notes ? { notes: c.notes } : {}),
    ...(c.photos && c.photos.length ? { photos: c.photos } : {}),
  }));
}

/** One maintenance-id bundle per DISTINCT failed check item id (predictive plan). */
function buildPlan(checks: Check[]) {
  const failed = [...new Set(checks.filter((c) => c.result === "FAIL").map((c) => c.checkItemId))];
  return failed.map((checkItemId) => ({
    checkItemId,
    maintenanceId: createId(),
    maintenanceLinkId: createId(),
    auditId: createId(),
  }));
}

export function useCheckRecordWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const completeCheckAndDeprepM = useMutation(api.checkRecordWrites.completeCheckAndDeprep);
  const completeCheckAndPackM = useMutation(api.checkRecordWrites.completeCheckAndPack);
  const completeCheckAndFlagM = useMutation(api.checkRecordWrites.completeCheckAndFlag);
  const completeCheckAndStoreM = useMutation(api.checkRecordWrites.completeCheckAndStore);
  const saveAdHocCheckM = useMutation(api.checkRecordWrites.saveAdHocCheck);
  const saveKitLevelChecksM = useMutation(api.checkRecordWrites.saveKitLevelChecks);
  const saveChildItemChecksM = useMutation(api.checkRecordWrites.saveChildItemChecks);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    completeCheckAndDeprep: async (data: {
      projectId: string;
      lineItemId: string;
      assetId?: string;
      bulkAssetId?: string | null;
      checks: Check[];
    }): Promise<{ success: true }> => {
      return completeCheckAndDeprepM({
        orgId: requireOrg(),
        projectId: data.projectId,
        lineItemId: data.lineItemId,
        ...(data.assetId ? { assetId: data.assetId } : {}),
        ...(data.bulkAssetId ? { bulkAssetId: data.bulkAssetId } : {}),
        checks: buildChecks(data.checks),
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    completeCheckAndPack: async (data: {
      projectId: string;
      lineItemId: string;
      assetId?: string;
      bulkAssetId?: string | null;
      prepContainer?: string | null;
      includeAccessoryIds?: string[];
      checks: Check[];
    }): Promise<{ success: true }> => {
      return completeCheckAndPackM({
        orgId: requireOrg(),
        projectId: data.projectId,
        lineItemId: data.lineItemId,
        ...(data.assetId ? { assetId: data.assetId } : {}),
        ...(data.bulkAssetId ? { bulkAssetId: data.bulkAssetId } : {}),
        prepContainer: data.prepContainer ?? undefined,
        ...(data.includeAccessoryIds ? { includeAccessoryIds: data.includeAccessoryIds } : {}),
        checks: buildChecks(data.checks),
        maintenancePlan: buildPlan(data.checks),
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    completeCheckAndFlag: async (data: {
      projectId: string;
      lineItemId: string;
      assetId?: string;
      bulkAssetId?: string | null;
      checks: Check[];
      flagType: "FLAGGED_FAULTY" | "FLAGGED_TT_OVERDUE";
    }): Promise<{ success: true }> => {
      return completeCheckAndFlagM({
        orgId: requireOrg(),
        projectId: data.projectId,
        lineItemId: data.lineItemId,
        ...(data.assetId ? { assetId: data.assetId } : {}),
        ...(data.bulkAssetId ? { bulkAssetId: data.bulkAssetId } : {}),
        flagType: data.flagType,
        checks: buildChecks(data.checks),
        maintenancePlan: buildPlan(data.checks),
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    completeCheckAndStore: async (data: {
      projectId: string;
      lineItemId: string;
      assetId?: string;
      bulkAssetId?: string | null;
      checks: Check[];
      condition: "GOOD" | "DAMAGED" | "MISSING";
      notes?: string;
    }): Promise<{ success: true }> => {
      return completeCheckAndStoreM({
        orgId: requireOrg(),
        projectId: data.projectId,
        lineItemId: data.lineItemId,
        ...(data.assetId ? { assetId: data.assetId } : {}),
        ...(data.bulkAssetId ? { bulkAssetId: data.bulkAssetId } : {}),
        condition: data.condition,
        ...(data.notes ? { notes: data.notes } : {}),
        checks: buildChecks(data.checks),
        maintenancePlan: buildPlan(data.checks),
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    saveAdHocCheck: async (data: {
      assetId: string;
      bulkAssetId?: string;
      checks: Check[];
    }): Promise<{ success: true }> => {
      return saveAdHocCheckM({
        orgId: requireOrg(),
        assetId: data.assetId,
        ...(data.bulkAssetId ? { bulkAssetId: data.bulkAssetId } : {}),
        checks: buildChecks(data.checks),
        maintenancePlan: buildPlan(data.checks),
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    saveKitLevelChecks: async (
      projectId: string,
      kitId: string,
      lineItemId: string,
      context: Context,
      checks: Check[],
    ): Promise<{ success: true }> => {
      return saveKitLevelChecksM({
        orgId: requireOrg(),
        projectId,
        kitId,
        lineItemId,
        context,
        checks: buildChecks(checks),
        now: Date.now(),
        actor: actor(),
      });
    },

    saveChildItemChecks: async (
      projectId: string,
      lineItemId: string,
      assetId: string | undefined,
      bulkAssetId: string | undefined | null,
      context: Context,
      checks: Check[],
    ): Promise<{ success: true }> => {
      return saveChildItemChecksM({
        orgId: requireOrg(),
        projectId,
        lineItemId,
        ...(assetId ? { assetId } : {}),
        ...(bulkAssetId ? { bulkAssetId } : {}),
        context,
        checks: buildChecks(checks),
        maintenancePlan: buildPlan(checks),
        now: Date.now(),
        actor: actor(),
      });
    },
  };
}
