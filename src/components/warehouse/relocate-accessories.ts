// Relocated accessories in the warehouse lists (#1296).
//
// An accessory normally rides under its parent. Once some of its units are
// packed into a DIFFERENT container than the parent ("batteries into the
// Battery Box"), those units are ordinary gear in THAT container: they show in
// its section, are selected, moved, deployed, returned and de-prepped on their
// own row, and the parent no longer lists them.
//
// This runs on the line-item list BEFORE the stage filters and `groupItems`, so
// every tab, the container sectioning and Move-to… see the split with no tab
// special-casing: a relocated group is just another line.
//
// The "is it relocated?" rule is `convex/lib/accessoryRelocation.ts` — the same
// one the server cascades use, so what the UI shows is what a parent action
// will (not) touch.

import {
  computeRollupCounters,
  deriveOrderLineStatus,
  type UnitLike,
} from "../../../convex/lib/lineItemUnits";
import { isRelocatedAccessoryUnit, parentContainerResolver } from "../../../convex/lib/accessoryRelocation";
import { isAccessoryParent, modelDisplayName, type LineItem } from "./warehouse-types";

type Unit = NonNullable<LineItem["units"]>[number];

/** Where a relocated unit is in its life. Each synthetic line holds ONE stage so
 *  its line-level fields (status / quantities) are simply true. */
type Stage = "waiting" | "out" | "returned" | "deprepped";

const SEP = "~"; // not ":" — that is the bulk positional-key separator

/** Synthetic line id for one (accessory line, container, stage) group. */
function relocatedId(accessoryId: string, containerId: string, stage: Stage): string {
  return ["reloc", accessoryId, containerId, stage].join(SEP);
}

export function isRelocatedLineId(id: string): boolean {
  return id.startsWith(`reloc${SEP}`);
}

function stageOf(u: Unit): Stage | null {
  if (u.status === "CANCELLED") return null;
  if (u.status === "CHECKED_OUT") return "out";
  if (u.status === "RETURNED") return u.prepStatus === "PACKED" ? "returned" : "deprepped";
  return u.prepStatus === "PACKED" ? "waiting" : null; // unpacked gear has no container to be "relocated" to
}

const qty = (u: Unit) => u.quantity ?? 1;

/** The line-level fields that make a single-stage group read correctly to the
 *  stage predicates (`isInPreppedStage`, `isInCheckedOutStage`, …). */
const STAGE_FIELDS: Record<Stage, (n: number) => Pick<LineItem, "status" | "prepStatus" | "checkedOutQuantity" | "returnedQuantity">> = {
  waiting: () => ({ status: "CONFIRMED", prepStatus: "PACKED", checkedOutQuantity: 0, returnedQuantity: 0 }),
  out: (n) => ({ status: "CHECKED_OUT", prepStatus: "PACKED", checkedOutQuantity: n, returnedQuantity: 0 }),
  returned: (n) => ({ status: "RETURNED", prepStatus: "PACKED", checkedOutQuantity: n, returnedQuantity: n }),
  deprepped: (n) => ({ status: "RETURNED", prepStatus: "PENDING", checkedOutQuantity: n, returnedQuantity: n }),
};

/** The identity fields a relocated group shows: one tagged unit keeps its tag on
 *  the row; several render as per-unit rows (so no line-level asset). */
function identityFields(units: Unit[]): Pick<LineItem, "assetId" | "bulkAssetId" | "asset" | "bulkAsset"> {
  const only = units.length === 1 ? units[0] : null;
  return {
    assetId: only?.assetId ?? null,
    bulkAssetId: only?.bulkAssetId ?? null,
    asset: only?.asset ? { assetTag: only.asset.assetTag } : null,
    bulkAsset: only?.bulkAsset ? { assetTag: only.bulkAsset.assetTag } : null,
  };
}

function relocatedGroup(parent: LineItem, accessory: LineItem, containerId: string, stage: Stage, units: Unit[]): LineItem {
  const n = units.reduce((sum, u) => sum + qty(u), 0);
  const name = accessory.model?.name ?? accessory.description ?? "Accessory";
  return {
    ...accessory,
    id: relocatedId(accessory.id, containerId, stage),
    parentLineItemId: parent.id,
    isKitChild: false,
    childKind: null,
    accessoryInclusion: null,
    quantity: n,
    ...STAGE_FIELDS[stage](n),
    ...identityFields(units),
    model: accessory.model && { ...accessory.model, name: `${name} (accessory of ${modelDisplayName(parent)})` },
    units,
    childLineItems: [],
  };
}

const asUnitLike = (u: Unit): UnitLike => ({
  quantity: qty(u),
  returnedQuantity: u.status === "RETURNED" ? qty(u) : 0,
  status: u.status,
  prepStatus: u.prepStatus,
  returnCondition: null,
  returnStatus: null,
});

/** The accessory line as it reads once its relocated units have left it. */
function remainderOf(accessory: LineItem, rest: Unit[]): LineItem {
  const like = rest.map(asUnitLike);
  const counters = computeRollupCounters(like);
  const stillPacked = rest.some((u) => u.prepStatus === "PACKED");
  return {
    ...accessory,
    units: rest,
    quantity: counters.assignedQuantity,
    checkedOutQuantity: counters.checkedOutQuantity,
    returnedQuantity: counters.returnedQuantity,
    status: deriveOrderLineStatus(accessory.status, like),
    // The stored prepStatus covered the relocated units too — drop PACKED once nothing left is.
    prepStatus: stillPacked || accessory.prepStatus !== "PACKED" ? accessory.prepStatus : "PENDING",
  };
}

export interface RelocationResult {
  /** The input list with each affected parent trimmed of its relocated units,
   *  and one synthetic line per (accessory, container, stage) inserted after it. */
  items: LineItem[];
  /** Synthetic lines by id — the key space the selection handlers route on. */
  relocatedById: Map<string, LineItem>;
}

/** Split one accessory line into the units that stay under the parent and the
 *  relocated groups, in a stable order. */
function splitAccessory(parent: LineItem, accessory: LineItem, parentContainerOf: (u: Unit) => string | null) {
  const stay: Unit[] = [];
  const groups = new Map<string, { containerId: string; stage: Stage; units: Unit[] }>();
  for (const u of accessory.units ?? []) {
    const stage = stageOf(u);
    if (!stage || !isRelocatedAccessoryUnit(u, parentContainerOf(u))) {
      stay.push(u);
      continue;
    }
    const containerId = u.containerId as string;
    const key = `${containerId}${SEP}${stage}`;
    const group = groups.get(key) ?? { containerId, stage, units: [] };
    group.units.push(u);
    groups.set(key, group);
  }
  return { stay, relocated: [...groups.values()].map((g) => relocatedGroup(parent, accessory, g.containerId, g.stage, g.units)) };
}

/** Pull relocated accessory units out from under their parents. */
export function relocateAccessories(lineItems: LineItem[]): RelocationResult {
  const relocatedById = new Map<string, LineItem>();
  const items: LineItem[] = [];

  for (const item of lineItems) {
    if (!isAccessoryParent(item)) {
      items.push(item);
      continue;
    }
    const parentContainerOf = parentContainerResolver(item.units ?? []);
    const synthetic: LineItem[] = [];
    const children = (item.childLineItems ?? []).flatMap((child) => {
      if (child.childKind !== "ACCESSORY") return [child];
      const { stay, relocated } = splitAccessory(item, child, parentContainerOf);
      if (relocated.length === 0) return [child];
      synthetic.push(...relocated);
      return stay.length > 0 ? [remainderOf(child, stay)] : [];
    });
    if (synthetic.length === 0) {
      items.push(item);
      continue;
    }
    for (const s of synthetic) relocatedById.set(s.id, s);
    items.push({ ...item, childLineItems: children }, ...synthetic);
  }
  return { items, relocatedById };
}

/**
 * Split a selection into the relocated accessory unit ids it names and the keys
 * that are ordinary lines. A relocated line is selected like any other: a bare
 * id (single / serialized) names all its units, a positional `id:idx` (bulk)
 * names that one unit — the index is into the line's own `units`, which the
 * bulk rows render in order.
 */
export function takeRelocatedSelection(
  keys: Iterable<string>,
  relocatedById: ReadonlyMap<string, LineItem>,
): { rest: string[]; unitIds: string[] } {
  const rest: string[] = [];
  const unitIds = new Set<string>();
  for (const key of keys) {
    const [lineId, idx] = key.split(":");
    const group = relocatedById.get(lineId);
    if (!group) {
      rest.push(key);
      continue;
    }
    const units = group.units ?? [];
    if (idx === undefined) units.forEach((u) => unitIds.add(u.id));
    else if (units[Number(idx)]) unitIds.add(units[Number(idx)].id);
  }
  return { rest, unitIds: [...unitIds] };
}
