import { toast } from "sonner";

import { showError } from "@/lib/show-error";

const UNDO_TOAST_DURATION_MS = 10_000;

export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** `Set 3 jobs to Booked · skipped P-001, P-004: already Booked`. Skipped rows are NAMED, never silent. */
export function listWriteTitle(done: string, skipped: { name: string; why: string }[]): string {
  if (skipped.length === 0) return done;
  const names = skipped.slice(0, 4).map((s) => s.name).join(", ");
  const more = skipped.length > 4 ? ` +${skipped.length - 4} more` : "";
  return `${done} · skipped ${names}${more}: ${skipped[0].why}`;
}

export interface ListWriteAnnouncement {
  title: string;
  undoneTitle: string;
  /** The reverse write; absent = no Undo offered. Errors surface as a toast. */
  performUndo?: () => Promise<void>;
}

/**
 * Toast a list write with Undo from ONE guarded closure. The returned closure
 * is the toast action's own onClick; a second surface that wants to offer the
 * same Undo must be handed it, never derive another (CLAUDE.md, scan strip rule).
 */
export function announceListWrite(a: ListWriteAnnouncement): (() => Promise<void>) | undefined {
  let undone = false;
  const undo = a.performUndo;
  const onUndo = undo
    ? async () => {
        if (undone) return;
        undone = true;
        try {
          await undo();
          toast.success(a.undoneTitle);
        } catch (e) {
          showError(e, { fallbackTitle: "Couldn't undo" });
        }
      }
    : undefined;
  toast.success(a.title, {
    duration: UNDO_TOAST_DURATION_MS,
    action: onUndo ? { label: "Undo", onClick: onUndo } : undefined,
  });
  return onUndo;
}
