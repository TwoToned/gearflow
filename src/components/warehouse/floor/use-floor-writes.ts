"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import { announceWarehouseWrite, countLabel } from "@/lib/warehouse-undo-toast";
import { useNativeProjectStatus } from "@/hooks/use-native-project-writes";
import { useWarehouseCloseWrites } from "@/hooks/use-warehouse-close-writes";
import type { OverrideTarget } from "@/lib/row-actions/floor-job";
import { OUT_LABEL } from "@/lib/vocabulary";

const WORD: Record<OverrideTarget, string> = { CHECKED_OUT: OUT_LABEL, RETURNED: "Returned", COMPLETED: "Completed" };

/**
 * The floor's writes. The status overrides and Close out are irreversible
 * from here (no reverse mutation), so they confirm first (in the menu / bulk
 * bar) and toast after, with no Undo (plan Q5). The packer has an exact
 * reverse, so it toasts with Undo. The board is live, so nothing refetches.
 */
export function useFloorWrites(orgId: string | undefined) {
  const status = useNativeProjectStatus(orgId);
  const { batchCloseOut } = useWarehouseCloseWrites();
  const setPackerM = useMutation(api.projectWrites.setPackerNative);
  const { data: session } = useSession();
  const canUndo = useCanDo("warehouse", "check_out");

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

  /** `Assign packer…` (card and bulk). Undo replays the server's `previous`
   *  through the same mutation (one write, one reverse); absent without check_out. */
  const setPacker = useCallback(
    async (projectIds: string[], packerUserId: string | null) => {
      if (!orgId) return;
      try {
        const res = await setPackerM({
          orgId,
          assignments: projectIds.map((id) => ({ id, packerUserId })),
          actor: { userId: session?.user.id ?? "", userName: session?.user.name ?? "" },
          auditId: createId(),
          now: Date.now(),
        });
        const n = projectIds.length;
        announceWarehouseWrite({ autoStatus: null }, {
          doneTitle: packerUserId ? `Packer set on ${countLabel(n, "job")}` : `Packer cleared on ${countLabel(n, "job")}`,
          undoneTitle: "Undone — packers restored",
          canUndo,
          performUndo: async () => {
            await setPackerM({
              orgId,
              assignments: res.previous,
              actor: { userId: session?.user.id ?? "", userName: session?.user.name ?? "" },
              auditId: createId(),
              now: Date.now(),
            });
          },
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not set the packer");
      }
    },
    [orgId, setPackerM, session, canUndo],
  );

  return { setStatus, closeOut, setPacker };
}
