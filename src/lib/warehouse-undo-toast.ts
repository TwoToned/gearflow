import { toast } from "sonner";
import { autoStatusToast } from "@/lib/project-status-automation";
import { showError } from "@/lib/show-error";

const UNDO_TOAST_DURATION_MS = 10_000;

export const countLabel = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface WarehouseUndoAnnouncement {
  /** Past-tense, counted title — e.g. "Deployed 12 items". */
  doneTitle: string;
  /** Shown after a successful undo — e.g. "Undone — 12 items back in Prepped". */
  undoneTitle: string;
  /** Whether the operator holds the REVERSE permission (never the forward one). */
  canUndo: boolean;
  /** Calls the reverse mutation. Errors are caught here and surfaced as a toast. */
  performUndo: () => Promise<void>;
}

/**
 * #1160 → #1222 — surface a status the server just advanced on its own, AND an
 * Undo action for the six browser-direct warehouse writes (`use-warehouse-writes.ts`,
 * D2: reversibility is a property of the mutation, not of the button that called it).
 *
 * `autoStatus` is only ever non-null on the ONE call that actually crossed the
 * boundary, so a 40-item deploy toasts at most once. The undo toast and the
 * #1160 status toast must never both fire (design doc's UI spec) — this is the
 * ONE place that decides, folding the status move into the same toast's title
 * (`Deployed 12 items · job moved to Deployed`) rather than showing two.
 */
export function announceWarehouseWrite<T extends { autoStatus?: string | null }>(
  res: T,
  undo: WarehouseUndoAnnouncement,
): T {
  const statusCopy = autoStatusToast(res.autoStatus);
  const title = statusCopy
    ? `${undo.doneTitle} · ${statusCopy.title.charAt(0).toLowerCase()}${statusCopy.title.slice(1)}`
    : undo.doneTitle;

  // Double-tap guard (spec: "the second tap is a no-op, not a second
  // reverse"). A plain closure var is enough — this call, and the toast
  // action bound to it, are both one-shot per forward write.
  let undone = false;
  const onUndoClick = async () => {
    if (undone) return;
    undone = true;
    try {
      await undo.performUndo();
      toast.success(undo.undoneTitle);
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't undo" });
    }
  };

  toast.success(title, {
    duration: UNDO_TOAST_DURATION_MS,
    action: undo.canUndo ? { label: "Undo", onClick: onUndoClick } : undefined,
  });

  return res;
}
