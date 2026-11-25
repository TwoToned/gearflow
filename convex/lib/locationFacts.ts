/**
 * Derived location facts (UX Phase 14, D42/D78). Pure; nothing here is stored except the inputs
 * (`capacity`, `labelPrintedAt`, `lastMovementAt`) that the owner approved as optional fields.
 *
 * `stored` is what the old Locations tile "Assets stored" and `locations.counts` already mean:
 * assets + bulk-asset LINES + kits whose `locationId` is this place.
 */

/** Percent full, whole number, or null when no capacity is set (never read as 0%). */
export function locationFill(stored: number, capacity: number | null | undefined): number | null {
  if (capacity == null || !Number.isFinite(capacity) || capacity < 1) return null;
  return Math.round((Math.max(0, stored) / capacity) * 100);
}

export type BinLabelState = "printed" | "not-printed";

export function binLabelState(labelPrintedAt: number | null | undefined): BinLabelState {
  return labelPrintedAt != null ? "printed" : "not-printed";
}

export const LOCATION_SEGMENT_KEYS = ["all", "warehouses", "vehicles", "sites", "empty"] as const;
export type LocationSegmentKey = (typeof LOCATION_SEGMENT_KEYS)[number];

export function parseLocationSegment(raw: string | undefined): LocationSegmentKey {
  return LOCATION_SEGMENT_KEYS.find((k) => k === raw) ?? "all";
}

/** Types in each strip word: `Sites` is Venue + Offsite. */
const SEGMENT_TYPES: Partial<Record<LocationSegmentKey, readonly string[]>> = {
  warehouses: ["WAREHOUSE"],
  vehicles: ["VEHICLE"],
  sites: ["VENUE", "OFFSITE"],
};

/**
 * Pure: does a location belong in a strip word? `subtreeStored` is the stored count of the place AND
 * everything under it, so a warehouse whose bins hold gear is not `Empty`.
 */
export function locationInSegment(loc: { type?: string | null }, segment: LocationSegmentKey, subtreeStored: number): boolean {
  if (segment === "all") return true;
  if (segment === "empty") return subtreeStored === 0;
  return (SEGMENT_TYPES[segment] ?? []).includes(loc.type ?? "OFFSITE");
}

/** Pure: each id's own stored count plus its descendants' (a cycle in bad data cannot loop forever). */
export function subtreeTotals(locs: { id: string; parentId?: string | null }[], own: ReadonlyMap<string, number>): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const l of locs) if (l.parentId) children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
  const totals = new Map<string, number>();
  const walk = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let sum = own.get(id) ?? 0;
    for (const c of children.get(id) ?? []) sum += walk(c, seen);
    return sum;
  };
  for (const l of locs) totals.set(l.id, walk(l.id, new Set()));
  return totals;
}
