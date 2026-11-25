/**
 * The Kits list as data (UX unification §9g, Phase 14). Pure. A kit's state is DERIVED on the server
 * (`convex/lib/kitState.ts`, D75); this module only names and prints it.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, RowFlag, StatusValue } from "@/lib/primitives/types";
import { conditionLabels } from "@/lib/status-labels";
import { OUT_LABEL } from "@/lib/vocabulary";

const SEGMENT_DEFS = [
  { key: "all", label: "All" },
  { key: "complete", label: "Complete" },
  { key: "missing", label: "Missing items" },
  { key: "onjob", label: "On a job" },
  { key: "maintenance", label: "In maintenance" },
  { key: "retired", label: "Retired" },
] as const;

export const KITS_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["cat", "loc", "tag"],
  sorts: ["assetTag", "name", "category", "location", "state", "condition", "purchasePrice"],
  defaultSort: "assetTag:asc",
};

export function kitSegments(counts: Record<string, number> | undefined): ListSegment[] {
  return SEGMENT_DEFS.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] }));
}

export function kitFilters(categories: { id: string; name: string }[], locations: { id: string; name: string }[], tags: string[]): ListFilterDef[] {
  return [
    { key: "cat", label: "Category", options: categories.map((c) => ({ value: c.id, label: c.name })) },
    { key: "loc", label: "Location", options: locations.map((l) => ({ value: l.id, label: l.name })) },
    { key: "tag", label: "Tags", options: tags.map((t) => ({ value: t, label: t })) },
  ];
}

export const KIT_ITEM_HEADER = "Kit";
export const KIT_ITEM_SORT_KEY = "assetTag";

/** Items / Complete / On job / Location by default; Value (what was paid), Condition and Tags are opt-in (D43). */
export const KIT_COLUMNS: FactColumn[] = [
  { id: "items", header: "Items", align: "end" },
  { id: "complete", header: "Complete", sortKey: "state" },
  { id: "onJob", header: "On job" },
  { id: "location", header: "Location", sortKey: "location" },
  { id: "value", header: "Value", align: "end", sortKey: "purchasePrice", optional: true },
  { id: "condition", header: "Condition", sortKey: "condition", optional: true },
  { id: "tags", header: "Tags", optional: true },
];

export function kitsQueryArgs(state: ListUrlState, now: number) {
  const f = state.filters;
  const segment = state.seg === "all" ? undefined : state.seg;
  return {
    search: state.q.trim() || undefined,
    categoryIdIn: f.cat?.length ? f.cat : undefined,
    locationIdIn: f.loc?.length ? f.loc : undefined,
    tagsHasSome: f.tag?.length ? f.tag : undefined,
    segment,
    // Every row's state can be Reserved, which reads the clock, so a mount-time snapshot is always passed.
    now,
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

export interface KitSource {
  id: string;
  assetTag: string;
  name: string;
  condition?: string | null;
  purchasePrice?: number | null;
  tags?: string[] | null;
  /** `null` = the call's read budget ran out before this row's count. */
  itemCount: number | null;
  category?: { name: string } | null;
  location?: { name: string } | null;
  media?: { url: string | null; thumbnailUrl: string | null } | null;
  /** `null` = the read budget ran out: the state is unknown (the row prints "—", never a guess). */
  state: {
    key: string;
    missing: { label: string; why: string }[];
    booking: { projectNumber: string; projectName: string } | null;
    /** The stored INCOMPLETE marker: cleared only by Mark complete. */
    reportedMissing: boolean;
  } | null;
}

const STATE_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  INCOMPLETE: "Incomplete",
  CHECKED_OUT: OUT_LABEL,
  IN_MAINTENANCE: "In maintenance",
  RETIRED: "Retired",
};

/** Inline dot-word: `1 item missing` (red). */
export function kitFlags(k: Pick<KitSource, "state">): RowFlag[] {
  const n = k.state?.missing.length ?? 0;
  if (n > 0) return [{ label: `${n} item${n === 1 ? "" : "s"} missing`, tone: "error" }];
  return k.state?.reportedMissing ? [{ label: "Reported missing", tone: "error" }] : [];
}

export function kitStatus(k: Pick<KitSource, "state">): StatusValue {
  if (!k.state) return { label: "—", intent: "neutral" };
  const key = k.state.key;
  const intent = key === "INCOMPLETE" ? "error" : key === "CHECKED_OUT" ? "primary" : key === "IN_MAINTENANCE" || key === "RESERVED" ? "warning" : key === "RETIRED" ? "neutral" : "success";
  return { label: STATE_LABELS[key] ?? key, intent, outline: key === "RETIRED" };
}

const DASH: Fact = { kind: "text", label: "—" };

/** The "Complete" column: unknown (budget ran out) prints a dash, never a guess. */
function completeFact(state: KitSource["state"]): Fact {
  if (!state) return DASH;
  return { kind: "text", label: state.key === "INCOMPLETE" ? "Missing" : "Complete" };
}

function kitFacts(k: KitSource): Record<string, Fact> {
  const job = k.state?.booking;
  return {
    items: k.itemCount == null ? DASH : { kind: "qty", value: k.itemCount },
    complete: completeFact(k.state),
    onJob: job ? { kind: "text", label: `${job.projectNumber} ${job.projectName}` } : DASH,
    value: { kind: "money", amount: k.purchasePrice ?? null },
    condition: { kind: "text", label: conditionLabels[k.condition ?? "GOOD"] ?? "" },
    ...placeAndTags(k),
  };
}

/** Location and tags are present only when the kit has them. */
function placeAndTags(k: KitSource): Record<string, Fact> {
  return {
    ...(k.location?.name ? { location: { kind: "place" as const, label: k.location.name } } : {}),
    ...(k.tags?.length ? { tags: { kind: "text" as const, label: k.tags.join(", ") } } : {}),
  };
}

export function kitRowOf(k: KitSource, menu?: ActionMenuSpec): LineRowData {
  const facts = kitFacts(k);
  return {
    id: k.id,
    kind: "kit",
    title: k.assetTag,
    subtitle: [k.name, k.category?.name].filter(Boolean).join(" · ") || undefined,
    tags: k.tags?.length ? k.tags : undefined,
    flags: kitFlags(k),
    facts,
    status: kitStatus(k),
    menu,
    href: `/kits/${k.id}`,
  };
}
