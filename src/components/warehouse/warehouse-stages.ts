// Warehouse item lifecycle — the single source of truth for "what stage is this
// piece of gear at?". Gear moves strictly left to right:
//
//   Pick/prep → Prepped → Deployed → Returned → De-prepped
//
// The data model carries two fields per line:
//   - status:     CONFIRMED | CHECKED_OUT | ON_SITE | RETURNED | COMPLETED | CANCELLED
//   - prepStatus: PENDING | PULLED | PACKED | FLAGGED_FAULTY | null
//
// A returned item keeps prepStatus PACKED until it is de-prep-checked back into
// inventory, at which point prepStatus resets to PENDING. That single fact is
// what separates "Returned" (physically back, not yet processed) from
// "De-prepped" (checked and back on the shelf) — and it's why a returned item
// must NEVER be re-derived as "needs prepping" just because its prepStatus is no
// longer PACKED. status === RETURNED always wins.

import type { LineItem } from "./warehouse-types";

export type WarehouseStageKey =
  | "to_prep"
  | "prepped"
  | "deployed"
  | "returned"
  | "deprepped";

export interface WarehouseStageMeta {
  key: WarehouseStageKey;
  label: string;
  /** Short helper shown under the stepper for the active stage. */
  hint: string;
}

export const WAREHOUSE_STAGES: WarehouseStageMeta[] = [
  { key: "to_prep", label: "Pick / prep", hint: "Pull gear and pack it ready to go." },
  { key: "prepped", label: "Prepped", hint: "Packed and waiting to be deployed." },
  { key: "deployed", label: "Deployed", hint: "Out on site with the crew." },
  { key: "returned", label: "Returned", hint: "Physically back — run return checks." },
  { key: "deprepped", label: "De-prepped", hint: "Checked and back in inventory." },
];

export const WAREHOUSE_STAGE_INDEX: Record<WarehouseStageKey, number> =
  WAREHOUSE_STAGES.reduce(
    (acc, s, i) => {
      acc[s.key] = i;
      return acc;
    },
    {} as Record<WarehouseStageKey, number>,
  );

export type WarehouseStageCounts = Record<WarehouseStageKey, number>;

function emptyCounts(): WarehouseStageCounts {
  return { to_prep: 0, prepped: 0, deployed: 0, returned: 0, deprepped: 0 };
}

/**
 * Derive the lifecycle stage of a single leaf line (an individual unit /
 * non-kit-parent line). Returns null for lines that are off the flow entirely
 * (cancelled, or zero-quantity prep-split leftovers).
 *
 * RETURNED short-circuits everything: a piece of gear that has come back reads
 * as Returned (awaiting de-prep) or De-prepped (done), never as "to prep".
 */
export function deriveItemStage(item: LineItem): WarehouseStageKey | null {
  if (item.status === "CANCELLED") return null;

  if (item.status === "RETURNED") {
    // Still packed → it's back but hasn't been de-prep-checked yet.
    // Anything else (prepStatus reset to PENDING/PULLED, flagged, or null) →
    // it's been processed back into inventory.
    return item.prepStatus === "PACKED" ? "returned" : "deprepped";
  }

  if (item.status === "CHECKED_OUT" || item.status === "ON_SITE") {
    return "deployed";
  }

  // Not out, not returned — it's still in the prep half of the flow.
  return item.prepStatus === "PACKED" ? "prepped" : "to_prep";
}

/** Is this line a kit parent or a sub-hire / accessory group parent? */
function isParentLine(item: LineItem): boolean {
  const hasChildren = (item.childLineItems?.length ?? 0) > 0;
  if (!hasChildren) return false;
  if (item.isKitChild) return false;
  // kit parent (has kitId) OR group/sub-hire parent (no kitId, has children)
  return true;
}

/**
 * Count how many pieces of gear sit at each lifecycle stage for a project.
 *
 * Counts by LINE (one per leaf line), expanding kit / group parents into their
 * children so the totals reflect actual units rather than wrapper rows. This is
 * a high-level overview for the header stepper, not an exact per-unit inventory
 * reconciliation — a partially-returned bulk line is counted at its dominant
 * status. Containers and cancelled lines are excluded.
 *
 * Pass the page's `equipmentItems` (already filtered to top-level EQUIPMENT,
 * non-container, non-hidden lines).
 */
export function summarizeWarehouseStages(items: LineItem[]): WarehouseStageCounts {
  const counts = emptyCounts();

  const visit = (li: LineItem) => {
    if (li.isContainerLineItem) return;
    if (isParentLine(li)) {
      for (const child of li.childLineItems ?? []) visit(child);
      return;
    }
    const stage = deriveItemStage(li);
    if (stage) counts[stage] += 1;
  };

  for (const item of items) visit(item);
  return counts;
}

/** Total pieces of gear across all stages. */
export function totalStaged(counts: WarehouseStageCounts): number {
  return WAREHOUSE_STAGES.reduce((sum, s) => sum + counts[s.key], 0);
}

/**
 * The "active front" — the earliest stage that still has gear needing a human
 * action (to_prep, prepped, returned). Deployed gear is waiting on the crew, not
 * the warehouse, so it isn't an action front; if nothing needs action we report
 * the furthest stage that has gear so the stepper points at where things ended
 * up (deployed while on site, or deprepped when the job is wrapped).
 */
export function activeWarehouseStage(counts: WarehouseStageCounts): WarehouseStageKey {
  const actionOrder: WarehouseStageKey[] = ["to_prep", "prepped", "returned"];
  for (const key of actionOrder) {
    if (counts[key] > 0) return key;
  }
  if (counts.deployed > 0) return "deployed";
  if (counts.deprepped > 0) return "deprepped";
  return "to_prep";
}
