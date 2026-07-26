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
 */
export function useConfirmStatusGate(
  orgId: string | undefined,
  projectId: string,
  currentStatus: string | undefined,
  onProceed: (nextStatus: string) => void,
) {
  const convex = useConvex();
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<{ status: string; impact: ConfirmImpact } | null>(null);

  const requestStatusChange = async (nextStatus: string) => {
    const isNewConfirmation = nextStatus === "CONFIRMED" && currentStatus !== "CONFIRMED";
    if (!isNewConfirmation || !orgId) {
      onProceed(nextStatus);
      return;
    }
    setChecking(true);
    try {
      const impact = await convex.query(api.overbookingBoard.confirmImpact, { orgId, projectId });
      if (impact.hardOverbookingModelCount > 0 || impact.unconfirmedCrewCount > 0) {
        setPending({ status: nextStatus, impact });
      } else {
        onProceed(nextStatus);
      }
    } catch {
      onProceed(nextStatus);
    } finally {
      setChecking(false);
    }
  };

  const confirmPending = () => {
    if (pending) onProceed(pending.status);
    setPending(null);
  };
  const cancelPending = () => setPending(null);

  return { requestStatusChange, checking, pending, confirmPending, cancelPending };
}
