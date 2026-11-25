/**
 * The Locations list as data (UX unification §9g, Phase 14, D42/D78). Pure. Fill and the label state
 * are derived on the server (`convex/lib/locationFacts.ts`); `Last movement` is stamped by
 * `convex/lib/locationMovement.ts` and prints `—` when absent, never a guess.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData } from "@/lib/primitives/types";
import { locationTypeLabels } from "@/lib/status-labels";

const SEGMENT_DEFS = [
  { key: "all", label: "All" },
  { key: "warehouses", label: "Warehouses" },
  { key: "vehicles", label: "Vehicles" },
  { key: "sites", label: "Sites" },
  { key: "empty", label: "Empty" },
] as const;

const TYPES = ["WAREHOUSE", "VEHICLE", "VENUE", "OFFSITE"] as const;

export const LOCATIONS_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["type", "tag"],
  sorts: ["name", "type", "assets", "capacity", "lastMovement"],
  defaultSort: "name:asc",
};

export function locationSegments(counts: Record<string, number> | undefined): ListSegment[] {
  return SEGMENT_DEFS.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] }));
}

export function locationFilters(tags: string[]): ListFilterDef[] {
  return [
    { key: "type", label: "Type", options: TYPES.map((t) => ({ value: t, label: locationTypeLabels[t] ?? t })) },
    { key: "tag", label: "Tags", options: tags.map((t) => ({ value: t, label: t })) },
  ];
}

export const LOCATION_ITEM_HEADER = "Location";
export const LOCATION_ITEM_SORT_KEY = "name";

export const LOCATION_COLUMNS: FactColumn[] = [
  { id: "assets", header: "Assets", align: "end", sortKey: "assets" },
  { id: "capacity", header: "Capacity", align: "end", sortKey: "capacity" },
  { id: "lastMovement", header: "Last movement", sortKey: "lastMovement" },
  { id: "address", header: "Address", optional: true },
  { id: "tags", header: "Tags", optional: true },
];

export function locationsQueryArgs(state: ListUrlState) {
  const f = state.filters;
  return {
    search: state.q.trim() || undefined,
    typeIn: f.type?.filter((t) => (TYPES as readonly string[]).includes(t)).length ? f.type!.filter((t) => (TYPES as readonly string[]).includes(t)) : undefined,
    tagsHasSome: f.tag?.length ? f.tag : undefined,
    segment: state.seg === "all" ? undefined : state.seg,
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

export interface LocationSource {
  id: string;
  name: string;
  type: string;
  address: string | null;
  tags: string[];
  parentName: string | null;
  stored: number;
  binCount: number;
  capacity: number | null;
  fill: number | null;
  lastMovement: number | null;
  labelState: "printed" | "not-printed";
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/** `412 / 600 · 69%` with a capacity; just the count without one (never a 0%). */
export function capacityText(l: Pick<LocationSource, "stored" | "capacity" | "fill">): string {
  return l.capacity == null ? "not set" : `${l.stored} / ${l.capacity} · ${l.fill}%`;
}

export function locationRowOf(l: LocationSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = {
    assets: { kind: "qty", value: l.stored },
    capacity: { kind: "text", label: capacityText(l) },
    lastMovement: { kind: "text", label: l.lastMovement != null ? day(l.lastMovement) : "—" },
  };
  if (l.address) facts.address = { kind: "text", label: l.address };
  if (l.tags.length) facts.tags = { kind: "text", label: l.tags.join(", ") };
  const sub = [locationTypeLabels[l.type] ?? l.type, l.parentName, l.binCount > 0 ? `${l.binCount} bin${l.binCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  return { id: l.id, kind: "container", title: l.name, subtitle: sub || undefined, tags: l.tags.length ? l.tags : undefined, facts, menu, href: `/locations/${l.id}` };
}
