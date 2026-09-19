/**
 * Client-side mirror of `assertLineOwnsAccessoryPlan` (convex/lineItemWrites.ts)
 * — gates the "Edit accessories" menu entry the same way the server gates
 * `updateAccessoryPlanNative` itself: a top-level equipment line (not an
 * accessory/kit child), with a model or asset to resolve accessories from, that
 * hasn't deployed yet ("office decides, warehouse verifies"). UX-only — the
 * server re-validates on save regardless of what this returns.
 */
export function canEditAccessoryPlan(item: {
  isKitChild?: boolean;
  childKind?: string | null;
  modelId?: string | null;
  assetId?: string | null;
  checkedOutQuantity?: number;
  status?: string;
  subHireId?: string | null;
}): boolean {
  if (item.isKitChild || item.childKind) return false;
  if (item.subHireId) return false; // sub-hire lines have no catalog accessory config to resolve
  if (!item.modelId && !item.assetId) return false;
  if ((item.checkedOutQuantity ?? 0) > 0 || item.status === "CHECKED_OUT") return false;
  return true;
}
