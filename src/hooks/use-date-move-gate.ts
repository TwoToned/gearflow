"use client";

import { useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isConfirmedOrLater } from "../../convex/lib/projectLocks";

export interface DateMoveImpactRow {
  modelId: string;
  modelName: string;
  qty: number;
  projectNumbers: string[];
}

/** Either side `null` means that end of the window is unset. */
export interface ProjectWindowMs {
  start: number | null;
  end: number | null;
}

/**
 * Date-move impact preview gate (#1227, Q3 of the QOL sweep): non-blocking,
 * same shape as `useConfirmStatusGate`. Before a project edit save actually
 * lands, previews the impact via a ONE-SHOT `overbookingBoard.dateMoveImpact`
 * query — but ONLY when the resolved window actually moved AND the project
 * is CONFIRMED or later (a pre-confirm job's demand isn't hard, so there's
 * nothing to warn about). If the preview finds nothing, or the check doesn't
 * even apply, the save proceeds immediately with zero UI change. If it finds
 * a hard shortage, the caller renders a warn+confirm dialog — "Save anyway"
 * always proceeds with the exact same save the caller asked for; there is no
 * code path where this blocks it. **Fails open** on any query error (an
 * advisory check must never block a real edit).
 */
export function useDateMoveGate<TData>(
  orgId: string | undefined,
  projectId: string,
  currentStatus: string | undefined,
  currentWindow: ProjectWindowMs,
  onProceed: (data: TData) => void,
) {
  const convex = useConvex();
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<{ data: TData; rows: DateMoveImpactRow[] } | null>(null);

  const requestSave = async (newWindow: ProjectWindowMs, data: TData) => {
    const windowMoved = newWindow.start !== currentWindow.start || newWindow.end !== currentWindow.end;
    if (!windowMoved || !orgId || newWindow.start == null || newWindow.end == null || !isConfirmedOrLater(currentStatus)) {
      onProceed(data);
      return;
    }
    setChecking(true);
    try {
      const impact = await convex.query(api.overbookingBoard.dateMoveImpact, {
        orgId,
        projectId,
        start: newWindow.start,
        end: newWindow.end,
      });
      if (impact.rows.length > 0) {
        setPending({ data, rows: impact.rows });
      } else {
        onProceed(data);
      }
    } catch {
      onProceed(data);
    } finally {
      setChecking(false);
    }
  };

  const confirmPending = () => {
    if (pending) onProceed(pending.data);
    setPending(null);
  };
  const cancelPending = () => setPending(null);

  return { requestSave, checking, pending, confirmPending, cancelPending };
}
