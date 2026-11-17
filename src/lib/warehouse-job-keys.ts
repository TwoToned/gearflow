/**
 * The adapter between the job table's ROW ids (one per line) and the legacy
 * handlers' selection KEYS (a bare line id, or `id:i` per unit for a bulk
 * line). Pure, so the strangler step is testable and the old handlers keep
 * their key contract until they are rewritten.
 */
import {
  accessoryChildrenOf, bulkUnitKey, isBulkItem, parentAlreadyPrepped, type LineItem,
} from "@/components/warehouse/warehouse-types";
import { stageQuantity, type JobStage } from "@/lib/warehouse-job-rows";
import type { PrepSelectionInfo } from "@/components/warehouse/job/prep-split-button";

/** Row ids → legacy keys. A bulk line expands to one `id:i` per unit IN `stage`. */
export function keysForRowIds(lineItems: readonly LineItem[], ids: Iterable<string>, stage: JobStage): string[] {
  const byId = new Map(lineItems.map((l) => [l.id, l]));
  const keys: string[] = [];
  for (const id of ids) {
    const li = byId.get(id);
    if (li && isBulkItem(li)) {
      for (let u = 0; u < stageQuantity(li, stage); u++) keys.push(bulkUnitKey(id, u));
    } else {
      keys.push(id);
    }
  }
  return keys;
}

const stillToPack = (c: LineItem) =>
  c.status !== "CANCELLED" && c.status !== "CHECKED_OUT" && c.status !== "RETURNED" && c.prepStatus !== "PACKED";

/** What the ticked To-pick lines look like to `Prep ▾` (spec §9.5). */
export function prepSelectionInfo(lineItems: readonly LineItem[], ids: Iterable<string>): PrepSelectionInfo {
  const byId = new Map(lineItems.map((l) => [l.id, l]));
  const info: PrepSelectionInfo = { count: 0, parentUnits: 0, packedParents: 0, accessoryLines: 0 };
  for (const id of ids) {
    const li = byId.get(id);
    if (!li) continue;
    info.count++;
    if (parentAlreadyPrepped(li)) info.packedParents++;
    else info.parentUnits += stageQuantity(li, "pick");
    info.accessoryLines += accessoryChildrenOf(li).filter(stillToPack).length;
  }
  return info;
}
