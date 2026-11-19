/**
 * The adapter between the job table's ROW ids (one per line) and the legacy
 * handlers' selection KEYS (a bare line id, or `id:i` per unit for a bulk
 * line). Pure, so the strangler step is testable and the old handlers keep
 * their key contract until they are rewritten.
 */
import {
  accessoryChildrenOf, bulkUnitKey, isBulkItem, parentAlreadyPrepped, type LineItem,
} from "@/components/warehouse/warehouse-types";
import { accessoryKey } from "@/components/warehouse/relocate-accessories";
import { isInternalStockLine } from "@/lib/warehouse-subhire-filter";
import { stageQuantity, type JobStage } from "@/lib/warehouse-job-rows";
import type { PrepSelectionInfo } from "@/components/warehouse/job/prep-split-button";

/** A real kit/accessory CHILD (never a row of its own; kits go through their parent's kit-atomic path).
 *  A sub-hire group child is its own line in the legacy page, so it stays selectable. */
const isRealKitChild = (li: LineItem) => !!li.isKitChild && (!!li.kitId || isInternalStockLine(li.subHireId));

/** Ids of the ACCESSORY lines still nested under a top-level line (the child rows a user can tick). */
function nestedAccessoryIds(lineItems: readonly LineItem[]): Set<string> {
  const ids = new Set<string>();
  for (const li of lineItems) for (const c of li.childLineItems ?? []) if (c.childKind === "ACCESSORY") ids.add(c.id);
  return ids;
}

/** Row ids → legacy keys. A bulk line expands to one `id:i` per unit IN `stage`.
 *  A real kit child is rejected outright: it must go through its parent's kit path. */
export function keysForRowIds(lineItems: readonly LineItem[], ids: Iterable<string>, stage: JobStage): string[] {
  const byId = new Map(lineItems.map((l) => [l.id, l]));
  const nested = nestedAccessoryIds(lineItems);
  const keys: string[] = [];
  for (const id of ids) {
    // A ticked accessory CHILD row is actioned on its own (every unit of that accessory line).
    if (nested.has(id)) {
      keys.push(accessoryKey(id));
      continue;
    }
    const li = byId.get(id);
    if (li && isRealKitChild(li)) continue;
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

/** Row ids for the Prep verbs, split as the live `prepActionAvailability` gate did: the parent verbs never
 *  see an already-packed parent, the accessories-only verbs never see an unpacked one. */
export function prepRowIds(lineItems: readonly LineItem[], ids: Iterable<string>, kind: "parents" | "accessories"): string[] {
  const byId = new Map(lineItems.map((l) => [l.id, l]));
  return [...ids].filter((id) => {
    const l = byId.get(id);
    // Packed = an accessory parent whose own gear is packed/out, or any line already marked PACKED.
    return !!l && (parentAlreadyPrepped(l) || l.prepStatus === "PACKED") === (kind === "accessories");
  });
}
