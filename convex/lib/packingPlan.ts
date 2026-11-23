/**
 * Packing-plan rules shared by the server and the Packing tab (plain module, no
 * Convex imports; POLICY.md R-3.1): what a plannable line IS, and how many lines
 * one plan write may carry. Next to `packedUnit.ts`, which owns "packed".
 */

/** Lines per `setPlannedContainerNative` call; matches `assertBulkSizeOk`'s human cap (500). */
export const MAX_PLAN_LINES = 500;

export interface PlannableLineLike {
  type?: string | null;
  status?: string | null;
  isKitChild?: boolean | null;
  isContainerLineItem?: boolean | null;
}

/** A top-level equipment line: not a kit child, not a case's own line, not cancelled. */
export function isPlannableLine(l: PlannableLineLike): boolean {
  if (l.type !== "EQUIPMENT") return false;
  if (l.isKitChild || l.isContainerLineItem) return false;
  return (l.status ?? "") !== "CANCELLED";
}
