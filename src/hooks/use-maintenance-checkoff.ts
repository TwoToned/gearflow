"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * WS6 #945 — recurring preventative maintenance check-off writes
 * (convex/maintenanceCheckoffWrites.ts). Serialised units are checked off one
 * at a time; bulk pools in quantity sessions (incl. "check all remaining").
 */
export function useMaintenanceCheckoff() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const checkOffUnitM = useMutation(api.maintenanceCheckoffWrites.checkOffUnit);
  const checkOffBulkSessionM = useMutation(api.maintenanceCheckoffWrites.checkOffBulkSession);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    checkOffUnit: async (recordId: string, assetId: string): Promise<{ completed: boolean }> => {
      const org = requireOrg();
      return await checkOffUnitM({
        orgId: org,
        recordId,
        assetId,
        checkoffId: createId(),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    checkOffBulkQuantity: async (
      recordId: string,
      bulkAssetId: string,
      quantity: number,
    ): Promise<{ completed: boolean; quantityRecorded: number }> => {
      const org = requireOrg();
      return await checkOffBulkSessionM({
        orgId: org,
        recordId,
        bulkAssetId,
        sessionId: createId(),
        quantity,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    checkOffAllRemaining: async (
      recordId: string,
      bulkAssetId: string,
    ): Promise<{ completed: boolean; quantityRecorded: number }> => {
      const org = requireOrg();
      return await checkOffBulkSessionM({
        orgId: org,
        recordId,
        bulkAssetId,
        sessionId: createId(),
        checkAllRemaining: true,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
