"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";

export interface ConfirmImpact {
  hardOverbookingModelCount: number;
  hardOverbookingQty: number;
  unconfirmedCrewCount: number;
}

/**
 * Confirm-time gate (spec decision, WS3 #942): non-blocking. Before a status
 * change lands on CONFIRMED (and only then — every other transition proceeds
 * immediately, unchanged), previews the impact via a ONE-SHOT
 * `overbookingBoard.confirmImpact` query. If it finds nothing to warn about,
 * the transition proceeds exactly as before with zero UI change. If it finds
 * a hard-overbooking or unconfirmed-crew risk, the caller renders a
 * warn+confirm dialog — the user can still proceed regardless of the answer;
 * this hook only ever delays the mutation by one round trip, it never
 * disables it. If the preview itself fails (permissions edge case, network),
 * fails OPEN (proceeds) rather than blocking a real status change on an
 * advisory check.
 *
 * #1244 — `projectId`/`currentStatus` moved from hook-creation time to CALL
 * time (`requestStatusChange(projectId, currentStatus, nextStatus)`), so ONE
 * hook instance can serve many projects — the revived project board
 * (`project-board.tsx`) previews a drop on whichever card is being dragged,
 * not a single project fixed for the component's whole lifetime. The
 * project detail page (still one project per page) now passes its own
 * `id`/`project.status` on every call instead of once at the top.
 */
export function useConfirmStatusGate(
  orgId: string | undefined,
  onProceed: (projectId: string, nextStatus: string) => void,
) {
  const convex = useConvex();
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<{ projectId: string; status: string; impact: ConfirmImpact } | null>(null);

  const requestStatusChange = async (projectId: string, currentStatus: string | undefined, nextStatus: string) => {
    const isNewConfirmation = nextStatus === "CONFIRMED" && currentStatus !== "CONFIRMED";
    if (!isNewConfirmation || !orgId) {
      onProceed(projectId, nextStatus);
      return;
    }
    setChecking(true);
    try {
      const impact = await convex.query(api.overbookingBoard.confirmImpact, { orgId, projectId });
      if (impact.hardOverbookingModelCount > 0 || impact.unconfirmedCrewCount > 0) {
        setPending({ projectId, status: nextStatus, impact });
      } else {
        onProceed(projectId, nextStatus);
      }
    } catch {
      onProceed(projectId, nextStatus);
    } finally {
      setChecking(false);
    }
  };

  const confirmPending = () => {
    if (pending) onProceed(pending.projectId, pending.status);
    setPending(null);
  };
  const cancelPending = () => setPending(null);

  return { requestStatusChange, checking, pending, confirmPending, cancelPending };
}
