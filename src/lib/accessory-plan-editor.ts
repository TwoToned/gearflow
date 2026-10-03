/**
 * Pure seed/derive/compare helpers for the per-line accessory picker (issue
 * #794). Extracted from `EditAccessoryPlanDialog` so the two post-add entry
 * points — the row kebab's standalone "Edit accessories" dialog and the
 * Accessories section inside the Edit Item dialog — share ONE definition of
 * "what the checkboxes mean" (R-3.1). The add-time picker seeds differently
 * (every DEFAULT included, no stored plan to read) and so keeps its own tiny
 * seed in `EquipmentAddForm`; the DERIVE side is the same shape.
 *
 * Plain module (no hooks, no "use client") so it is unit-testable without a
 * renderer — see `src/lib/__tests__/accessory-plan-editor.test.ts`.
 */

import type { ModelAccessoryDetail } from "@/server/line-items";
import type { AccessoryPlanInput } from "@/hooks/use-line-item-writes";

export interface AccessorySelectionState {
  /** Accessory catalog-row id → included on this line. */
  selection: Record<string, boolean>;
  /** Accessory catalog-row id → typed reason for a deselected DEFAULT. */
  excludeReasons: Record<string, string>;
}

/** An OPTIONAL row starts excluded unless its `bulkAssetId` was opted in. */
function seedOptionalRow(a: ModelAccessoryDetail, currentPlan: AccessoryPlanInput | undefined): boolean {
  return currentPlan?.added?.some((x) => x.bulkAssetId === a.bulkAssetId) ?? false;
}

/** A DEFAULT row starts included unless its `bulkAssetId` was excluded — in
 *  which case it also carries whatever reason was recorded for the removal. */
function seedDefaultRow(
  a: ModelAccessoryDetail,
  currentPlan: AccessoryPlanInput | undefined,
): { included: boolean; reason?: string } {
  const excluded = currentPlan?.excluded?.includes(a.bulkAssetId) ?? false;
  if (!excluded) return { included: true };
  return { included: false, reason: currentPlan?.excludedReasons?.find((r) => r.bulkAssetId === a.bulkAssetId)?.reason };
}

/** Seed `selection`/`excludeReasons` from the line's stored `accessoryPlan`
 *  against the model/asset's CURRENT catalog rows. */
export function seedAccessorySelection(
  accessories: ModelAccessoryDetail[],
  currentPlan: AccessoryPlanInput | undefined,
): AccessorySelectionState {
  const selection: Record<string, boolean> = {};
  const excludeReasons: Record<string, string> = {};
  for (const a of accessories) {
    if (a.inclusion === "OPTIONAL") {
      selection[a.id] = seedOptionalRow(a, currentPlan);
      continue;
    }
    const row = seedDefaultRow(a, currentPlan);
    selection[a.id] = row.included;
    if (row.reason) excludeReasons[a.id] = row.reason;
  }
  return { selection, excludeReasons };
}

/** Derive the `AccessoryPlanInput` to save from the current checkbox state —
 *  same shape `EquipmentAddForm` derives at add time, but always the FULL
 *  required arrays (`updateAccessoryPlanNative` replaces the whole plan, so
 *  "nothing overridden" is `{excluded: [], added: []}`, never `undefined`). */
export function derivePlanToSave(
  accessories: ModelAccessoryDetail[],
  selection: Record<string, boolean>,
  excludeReasons: Record<string, string>,
): AccessoryPlanInput {
  const excludedRows = accessories.filter((a) => a.inclusion !== "OPTIONAL" && selection[a.id] === false);
  const added = accessories
    .filter((a) => a.inclusion === "OPTIONAL" && selection[a.id] === true)
    .map((a) => ({ bulkAssetId: a.bulkAssetId }));
  return {
    excluded: excludedRows.map((a) => a.bulkAssetId),
    added,
    excludedReasons: excludedRows.map((a) => ({ bulkAssetId: a.bulkAssetId, reason: excludeReasons[a.id] ?? "" })),
  };
}

/** Order-insensitive comparison of the parts `updateAccessoryPlanNative` acts
 *  on — which children exist (`excluded`/`added`), not the free-text reasons
 *  (a reason change alone reconciles nothing, so it must not count as dirty and
 *  fire a needless write). The Edit Item dialog saves the plan only when this
 *  says the selection actually moved, so an untouched line never gets its
 *  children reconciled just because someone edited its price. */
export function accessoryPlansEqual(
  a: AccessoryPlanInput | undefined,
  b: AccessoryPlanInput | undefined,
): boolean {
  const ids = (plan: AccessoryPlanInput | undefined) => ({
    excluded: [...(plan?.excluded ?? [])].sort(),
    added: [...(plan?.added ?? [])].map((x) => x.bulkAssetId).sort(),
  });
  const left = ids(a);
  const right = ids(b);
  return (
    left.excluded.length === right.excluded.length &&
    left.excluded.every((v, i) => v === right.excluded[i]) &&
    left.added.length === right.added.length &&
    left.added.every((v, i) => v === right.added[i])
  );
}
