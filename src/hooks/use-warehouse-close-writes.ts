"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct WAREHOUSE-CLOSE writes (Phase 3 — replaces the closeOutProject/
 * batchCloseOut server actions in src/server/warehouse-close.ts). The pending-items
 * guard, return-condition tally, race-safe insert, and audit now run inside the
 * guarded `api.warehouseCloseWrites.*` mutations. The warehouseCloses table is a
 * reactive native subscription (close-out-tab already subscribes), so a close is
 * reflected live with no server-action refetch.
 *
 * The client mints every cuid: the warehouseClose `id` + the audit `id`(s) (Convex
 * mutations can't mint a cuid deterministically). For a batch, each item carries its
 * own {id, auditId}, plus one batchAuditId for the batch-summary audit row.
 */
export type BatchCloseResult = {
  projectId: string;
  projectName: string;
  success: boolean;
  error?: string;
};

export function useWarehouseCloseWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const closeM = useMutation(api.warehouseCloseWrites.closeOutNative);
  const batchM = useMutation(api.warehouseCloseWrites.batchCloseOutNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    closeOut: async (
      projectId: string,
    ): Promise<{ storedCount: number; damagedCount: number; lostCount: number }> => {
      const res = await closeM({
        id: createId(),
        orgId: requireOrg(),
        projectId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
      return {
        storedCount: res.storedCount,
        damagedCount: res.damagedCount,
        lostCount: res.lostCount,
      };
    },
    batchCloseOut: async (projectIds: string[]): Promise<BatchCloseResult[]> => {
      return await batchM({
        orgId: requireOrg(),
        items: projectIds.map((projectId) => ({
          projectId,
          id: createId(),
          auditId: createId(),
        })),
        now: Date.now(),
        actor: actor(),
        batchAuditId: createId(),
      });
    },
  };
}
