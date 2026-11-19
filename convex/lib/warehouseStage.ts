/**
 * The floor's stage, DERIVED from unit state (spec §9c.2, D27). Never stored,
 * never dragged: the one way to disagree with the scanner is a card ⋯ › Admin
 * override (D6), which moves real state and lets this re-derive.
 *
 * Pure (no ctx), so `warehouseList.bundle`, `warehouseFloor`, the board, the
 * phone stage strip and the URL parser all import THIS copy (src already imports
 * `convex/lib/*`). Counts come from the line-level rollup counters
 * (`convex/lib/lineItemUnits.ts` `computeRollupCounters`), so a half-returned
 * line reads as Returning — the old card counted top-level line STATUS, so the
 * same line read as Out.
 *
 * Which lines count (the "leaf, deployable" rule): only physically picked gear
 * (`type ?? "EQUIPMENT"` is EQUIPMENT), never a container row, never an
 * ACCESSORY child (it rides with its parent), never a cancelled or zero-quantity
 * row, and never a WRAPPER — a kit parent or a sub-hire GROUP row whose children
 * are the real gear. Same rule as `projectAutoStatus`'s `isStillInBuilding`,
 * decided here from the loaded line set instead of a per-row child lookup.
 */

export const FLOOR_STAGE_KEYS = ["topick", "prepping", "ready", "out", "returning"] as const;
export type FloorStage = (typeof FLOOR_STAGE_KEYS)[number];

/** The subset of a `projectLineItems` row the floor reads. */
export interface FloorLine {
  id: string;
  type?: string | null;
  status?: string | null;
  quantity?: number | null;
  isKitChild?: boolean | null;
  childKind?: string | null;
  kitId?: string | null;
  subHireId?: string | null;
  parentLineItemId?: string | null;
  isContainerLineItem?: boolean | null;
  prepStatus?: string | null;
  packedQuantity?: number | null;
  checkedOutQuantity?: number | null;
  returnedQuantity?: number | null;
  damagedQuantity?: number | null;
  lostQuantity?: number | null;
}

/** Per-job unit counts. `lines` / `linesToPick` count leaf lines; the rest count units. */
export interface FloorCounts {
  lines: number;
  linesToPick: number;
  items: number;
  /** Packed and still in the building. Exact while nothing is out or back. */
  packed: number;
  out: number;
  back: number;
  damaged: number;
  missing: number;
}

export const EMPTY_FLOOR_COUNTS: FloorCounts = {
  lines: 0, linesToPick: 0, items: 0, packed: 0, out: 0, back: 0, damaged: 0, missing: 0,
};

/** Ids of rows that are WRAPPERS: something other than an accessory hangs off them. */
function wrapperIds(lines: readonly FloorLine[]): Set<string> {
  const ids = new Set<string>();
  for (const l of lines) {
    if (l.parentLineItemId && l.childKind !== "ACCESSORY") ids.add(l.parentLineItemId);
  }
  return ids;
}

/** A row that is itself gear the warehouse picks (see the file header). */
export function isFloorLeaf(line: FloorLine, wrappers: ReadonlySet<string>): boolean {
  if ((line.type ?? "EQUIPMENT") !== "EQUIPMENT") return false;
  if (line.isContainerLineItem) return false;
  if (line.childKind === "ACCESSORY") return false;
  if (line.status === "CANCELLED") return false;
  if ((line.quantity ?? 0) <= 0) return false;
  return !wrappers.has(line.id);
}

/**
 * One leaf's unit counts. A row with no counters (a legacy row, or one patched
 * straight to a status) falls back to its status, the same way
 * `projectAutoStatus.hasQuantityLeftToDeploy` treats an absent counter.
 */
export function lineUnitCounts(line: FloorLine) {
  const qty = line.quantity ?? 0;
  const out = line.checkedOutQuantity ?? (line.status === "CHECKED_OUT" ? qty : 0);
  const back = line.returnedQuantity ?? (line.status === "RETURNED" ? qty : 0);
  const packedRaw = line.packedQuantity ?? (line.status === "PREPPED" || line.prepStatus === "PACKED" ? qty : 0);
  // `packedQuantity` keeps counting a unit after it leaves (prepStatus stays
  // PACKED), so subtract what is out or back; floored, since a de-prepped unit
  // that came back is in `back` but no longer in `packed`.
  const packed = Math.max(0, Math.min(packedRaw, qty) - out - back);
  return { qty, out, back, packed, damaged: line.damagedQuantity ?? 0, missing: line.lostQuantity ?? 0 };
}

/** The job's floor counts from its LIVE version's lines. */
export function floorCounts(lines: readonly FloorLine[]): FloorCounts {
  const wrappers = wrapperIds(lines);
  const c: FloorCounts = { ...EMPTY_FLOOR_COUNTS };
  for (const line of lines) {
    if (!isFloorLeaf(line, wrappers)) continue;
    const l = lineUnitCounts(line);
    c.lines += 1;
    c.items += l.qty;
    c.packed += l.packed;
    c.out += l.out;
    c.back += l.back;
    c.damaged += l.damaged;
    c.missing += l.missing;
    if (l.packed + l.out + l.back < l.qty) c.linesToPick += 1;
  }
  return c;
}

/**
 * §9c.2 order: any unit back → Returning; any unit out → Out; nothing left to
 * pick → Ready (a job with no gear has nothing to pick); some packed →
 * Prepping; else To pick.
 */
export function warehouseStage(c: FloorCounts): FloorStage {
  if (c.back > 0) return "returning";
  if (c.out > 0) return "out";
  if (c.linesToPick === 0) return "ready";
  if (c.packed > 0) return "prepping";
  return "topick";
}

const DAY_MS = 86_400_000;

/**
 * `Late` is DERIVED (D29), never recorded: a unit still out past the job's
 * end, or one that came back after it. The end is a DATE, so "past it" means
 * past the end of that day (gear back on the last day is on time). A job with
 * no end date is never late.
 */
export function isLate(
  unit: { status?: string | null; returnedAt?: number | null },
  windowEnd: number | null,
  now: number,
): boolean {
  if (windowEnd == null) return false;
  if (unit.status === "CHECKED_OUT") return now >= windowEnd + DAY_MS;
  return returnedLate(unit, windowEnd);
}

/** The half of `isLate` that needs no clock: the unit came back after the end
 *  day. A query can compute this; "still out and late" needs `now`, so the
 *  client derives that half from the job's end. */
export function returnedLate(unit: { returnedAt?: number | null }, windowEnd: number | null): boolean {
  if (windowEnd == null || unit.returnedAt == null) return false;
  return unit.returnedAt >= windowEnd + DAY_MS;
}
