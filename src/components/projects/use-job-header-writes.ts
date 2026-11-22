"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { useNativeProjectStatus, useProjectWrites } from "@/hooks/use-native-project-writes";
import { useConfirmStatusGate } from "@/hooks/use-confirm-status-gate";
import { projectStatusLabel } from "@/lib/job-lifecycle";

type PricingLock = {
  pricingLocked: boolean;
  unlock: () => Promise<{ undoToken?: string }>;
  undoUnlock: (undoToken: string) => Promise<void>;
};

/** What a status move says, including the side effects the server adds on the way in. */
function statusToast(next: string, wasLocked: boolean): string {
  const word = projectStatusLabel(next);
  if (next === "CONFIRMED") return wasLocked ? `Moved to ${word} · snapshot taken` : `Moved to ${word} · snapshot taken, pricing locked`;
  if (next === "COMPLETED") return `Moved to ${word} · snapshot taken`;
  return `Moved to ${word}`;
}

/**
 * The job header's writes, moved out of the page (UX Phase 7). Each is the SAME
 * write the page used before: status through `useConfirmStatusGate` (the
 * confirm-impact heads-up, then `updateStatusNative`), cancel (`archive`),
 * delete, and the pricing unlock. The server owns every gate. When a move is
 * refused while blocking discussions are open, the toast offers `Open
 * discussion`.
 */
export function useJobHeaderWrites(opts: {
  projectId: string;
  orgId: string | undefined;
  blockingCount: number;
  pricingLock: PricingLock;
  openComments: () => void;
}) {
  const { projectId, orgId, blockingCount, pricingLock, openComments } = opts;
  const router = useRouter();
  const statusBrowser = useNativeProjectStatus(orgId);
  const projectWrites = useProjectWrites(orgId);

  const statusMutation = useServerMutation({
    mutationFn: async (nextStatus: string) => {
      const wasLocked = pricingLock.pricingLocked;
      await statusBrowser.updateStatus(projectId, nextStatus);
      return { nextStatus, wasLocked };
    },
    onSuccess: ({ nextStatus, wasLocked }) => {
      toast.success(statusToast(nextStatus, wasLocked));
      refreshProjectDetail(projectId);
    },
    onError: (e) =>
      toast.error(e.message, blockingCount > 0 ? { action: { label: "Open discussion", onClick: openComments } } : undefined),
  });

  const confirmGate = useConfirmStatusGate(orgId, (_projectId, next) => statusMutation.mutate(next));

  const cancelMutation = useServerMutation({
    mutationFn: () => projectWrites.archive(projectId),
    onSuccess: () => {
      toast.success("Job cancelled");
      refreshProjectDetail(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => projectWrites.remove(projectId),
    onSuccess: (result) => {
      const freed: string[] = [];
      if (result.freedAssets > 0) freed.push(`${result.freedAssets} asset${result.freedAssets === 1 ? "" : "s"}`);
      if (result.freedKits > 0) freed.push(`${result.freedKits} kit${result.freedKits === 1 ? "" : "s"}`);
      toast.success(freed.length > 0 ? `Job deleted — freed ${freed.join(" and ")}` : "Job deleted");
      router.push("/projects");
    },
    onError: (e) => toast.error(e.message),
  });

  // Undo reverses exactly THIS unlock (its token); the server refuses if the lock changed since.
  const undoUnlock = (token: string) =>
    pricingLock
      .undoUnlock(token)
      .then(() => toast.success("Pricing locked again"))
      .catch((e: Error) => toast.error(e.message));

  const unlockMutation = useServerMutation({
    mutationFn: () => pricingLock.unlock(),
    onSuccess: ({ undoToken }) =>
      toast.success("Pricing unlocked", undoToken ? { action: { label: "Undo", onClick: () => void undoUnlock(undoToken) } } : undefined),
    onError: (e) => toast.error(e.message),
  });

  return {
    requestStatus: (current: string, next: string) => void confirmGate.requestStatusChange(projectId, current, next),
    advancing: statusMutation.isPending || confirmGate.checking,
    confirmGate,
    statusPending: statusMutation.isPending,
    cancel: () => cancelMutation.mutate(),
    remove: () => deleteMutation.mutate(),
    deletePending: deleteMutation.isPending,
    unlock: () => unlockMutation.mutate(),
  };
}
