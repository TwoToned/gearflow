"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useNativeProjectStatus } from "@/hooks/use-native-project-writes";
import { useWarehouseCloseWrites } from "@/hooks/use-warehouse-close-writes";
import type { OverrideTarget } from "@/lib/row-actions/floor-job";
import { OUT_LABEL } from "@/lib/vocabulary";

const WORD: Record<OverrideTarget, string> = { CHECKED_OUT: OUT_LABEL, RETURNED: "Returned", COMPLETED: "Completed" };

/**
 * The floor's two writes. Both are irreversible from here (no reverse
 * mutation), so they confirm first (in the menu / bulk bar) and toast after,
 * with no Undo (plan Q5). The board is a live subscription, so nothing refetches.
 */
export function useFloorWrites(orgId: string | undefined) {
  const status = useNativeProjectStatus(orgId);
  const { batchCloseOut } = useWarehouseCloseWrites();

  const setStatus = useCallback(
    async (projectId: string, target: OverrideTarget) => {
      try {
        await status.updateStatus(projectId, target);
        toast.success(`Job marked ${WORD[target]}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not change the job's status");
      }
    },
    [status],
  );

  const closeOut = useCallback(
    async (projectIds: string[]) => {
      try {
        const results = (await batchCloseOut(projectIds)) as Array<{ success: boolean }>;
        const ok = results.filter((r) => r.success).length;
        const failed = results.length - ok;
        if (failed === 0) toast.success(`${ok} job${ok === 1 ? "" : "s"} closed out`);
        else toast.warning(`${ok} closed out, ${failed} failed`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not close out");
      }
    },
    [batchCloseOut],
  );

  return { setStatus, closeOut };
}
