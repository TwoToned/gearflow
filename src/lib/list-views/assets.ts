/**
 * The Assets registry as data (UX unification §9b): segments, filter words, columns,
 * URL spec, query args and the row mapping. Pure: no React, no router, no Convex.
 * `Kind` switches between two lists (`assets.listPage` and `bulkAssets.listPage`);
 * the page supplies the queries and handlers.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData } from "@/lib/primitives/types";
import { getStatusIntent } from "@/lib/status-colors";
import { assetStatusLabels, bulkAssetStatusLabels, conditionLabels } from "@/lib/status-labels";
import { OUT_LABEL } from "@/lib/vocabulary";

export type AssetKind = "serialized" | "bulk";

// ─── URL spec ────────────────────────────────────────────────────────────

const SEGMENT_DEFS = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "on-jobs", label: "On jobs" },
  { key: "maintenance", label: "In maintenance" },
  { key: "retired", label: "Retired" },
  { key: "due", label: "Due for T&T" },
  { key: "attention", label: "Needs attention" },
] as const;

export const ASSETS_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["kind", "status", "condition", "loc", "cat", "tag", "model"],
  sorts: ["assetTag", "model", "serialNumber", "status", "condition", "location", "totalQuantity", "availableQuantity"],
  defaultSort: "assetTag:asc",
  views: ["table", "grid"],
};

/** Bulk stock has no per-unit status, deployment or test-tag schedule: only All and Retired apply. */
const SERIALIZED_ONLY_SEGMENTS: readonly string[] = ["available", "on-jobs", "maintenance", "due", "attention"];

export function assetSegments(kind: AssetKind): ListSegment[] {
  return SEGMENT_DEFS.filter((s) => kind === "serialized" || !SERIALIZED_ONLY_SEGMENTS.includes(s.key)).map((s) => ({ key: s.key, label: s.label }));
}

export function kindOf(state: ListUrlState): AssetKind {
  return state.filters.kind?.[0] === "bulk" ? "bulk" : "serialized";
}

// ─── Filter words ────────────────────────────────────────────────────────

const SERIALIZED_STATUSES = ["AVAILABLE", "CHECKED_OUT", "RESERVED", "IN_MAINTENANCE", "RETIRED", "LOST"] as const;
const BULK_STATUSES = ["ACTIVE", "LOW_STOCK", "OUT_OF_STOCK", "RETIRED"] as const;
const CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

function assetStatusLabel(kind: AssetKind, status: string): string {
  if (kind === "serialized" && status === "CHECKED_OUT") return OUT_LABEL;
  return (kind === "bulk" ? bulkAssetStatusLabels : assetStatusLabels)[status] ?? status;
}

interface Named {
  id: string;
  name: string;
}

export interface AssetFilterSources {
  locations: Named[];
  categories: Named[];
  models: Named[];
  tags: string[];
  modelSearch: { value: string; onChange: (v: string) => void };
}

export function assetFilters(kind: AssetKind, src: AssetFilterSources): ListFilterDef[] {
  const statuses = kind === "bulk" ? BULK_STATUSES : SERIALIZED_STATUSES;
  const needle = src.modelSearch.value.trim().toLowerCase();
  const models = needle ? src.models.filter((m) => m.name.toLowerCase().includes(needle)) : src.models;
  const words: ListFilterDef[] = [
    {
      key: "kind",
      label: "Kind",
      single: true,
      options: [
        { value: "serialized", label: "Serialized" },
        { value: "bulk", label: "Bulk" },
      ],
    },
    { key: "status", label: "Status", options: statuses.map((s) => ({ value: s, label: assetStatusLabel(kind, s) })) },
  ];
  if (kind === "serialized") {
    words.push({ key: "condition", label: "Condition", options: CONDITIONS.map((c) => ({ value: c, label: conditionLabels[c] ?? c })) });
  }
  words.push(
    { key: "loc", label: "Location", options: src.locations.map((l) => ({ value: l.id, label: l.name })) },
    { key: "cat", label: "Category", options: src.categories.map((c) => ({ value: c.id, label: c.name })) },
    { key: "tag", label: "Tags", options: src.tags.map((t) => ({ value: t, label: t })) },
    {
      key: "model",
      label: "Model",
      options: models.slice(0, 100).map((m) => ({ value: m.id, label: m.name })),
      search: { ...src.modelSearch, placeholder: "Search models" },
    },
  );
  return words;
}

// ─── Columns ─────────────────────────────────────────────────────────────

export const ASSET_ITEM_HEADER = "Tag";
export const ASSET_ITEM_SORT_KEY = "assetTag";

export const SERIALIZED_COLUMNS: FactColumn[] = [
  { id: "model", header: "Model", sortKey: "model" },
  { id: "serial", header: "Serial", sortKey: "serialNumber" },
  { id: "status", header: "Status", sortKey: "status" },
  { id: "condition", header: "Condition", sortKey: "condition" },
  { id: "location", header: "Location", sortKey: "location" },
  { id: "nextDue", header: "Next due" },
  { id: "onJob", header: "On job" },
  // Opt-in from the page ⋯ › Columns.
  { id: "tags", header: "Tags", optional: true },
];

export const BULK_COLUMNS: FactColumn[] = [
  { id: "model", header: "Model", sortKey: "model" },
  { id: "available", header: "Available", align: "end", sortKey: "availableQuantity" },
  { id: "total", header: "Total", align: "end", sortKey: "totalQuantity" },
  { id: "status", header: "Status", sortKey: "status" },
  { id: "location", header: "Location", sortKey: "location" },
  { id: "tags", header: "Tags", optional: true },
];

// ─── Query ───────────────────────────────────────────────────────────────

/** The URL contract drops unknown values: keep only those in `allowed` (none left = no filter). */
function known(values: string[] | undefined, allowed?: readonly string[]): string[] | undefined {
  const kept = allowed ? values?.filter((v) => allowed.includes(v)) : values;
  return kept && kept.length > 0 ? kept : undefined;
}

/** Args shared by `assets.listPage` and `bulkAssets.listPage`. */
export function assetsQueryArgs(state: ListUrlState) {
  const f = state.filters;
  const kind = kindOf(state);
  return {
    search: state.q.trim() || undefined,
    statusIn: known(f.status, kind === "bulk" ? BULK_STATUSES : SERIALIZED_STATUSES),
    locationIdIn: known(f.loc),
    categoryIdIn: known(f.cat),
    tagsHasSome: known(f.tag),
    modelIdIn: known(f.model),
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

/** Extra args only `assets.listPage` takes. */
export function serializedQueryArgs(state: ListUrlState, now: number) {
  const segment = state.seg === "all" ? undefined : state.seg;
  return {
    conditionIn: known(state.filters.condition, CONDITIONS),
    segment,
    // `now` is only read for the T&T segments; keep it out of other queries' keys.
    now: segment === "due" || segment === "attention" ? now : undefined,
  };
}

/** `bulkAssets.listPage` has no derived segments: Available/On jobs/Due map to nothing. */
export function bulkQueryArgs(state: ListUrlState) {
  return { isActive: state.seg === "retired" ? false : undefined };
}

// ─── Rows ────────────────────────────────────────────────────────────────

/** The fields of a listPage item the list reads (both kinds). */
export interface AssetSource {
  id: string;
  assetTag: string;
  modelId: string;
  serialNumber?: string | null;
  customName?: string | null;
  status?: string | null;
  condition?: string | null;
  totalQuantity?: number;
  availableQuantity?: number;
  tags?: string[] | null;
  model?: { name?: string | null; category?: { name?: string | null } | null } | null;
  location?: { name?: string | null } | null;
}

/** The page-scoped derived columns (`assets.rowExtras`). */
export interface AssetExtras {
  nextDue?: number | null;
  job?: { id: string; name: string; number: string } | null;
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

function serializedFacts(a: AssetSource, extras: AssetExtras): Record<string, Fact> {
  const facts: Record<string, Fact> = {};
  if (a.model?.name) facts.model = { kind: "text", label: a.model.name };
  if (a.serialNumber) facts.serial = { kind: "text", label: a.serialNumber };
  facts.condition = { kind: "text", label: conditionLabels[a.condition ?? "GOOD"] ?? "" };
  if (a.location?.name) facts.location = { kind: "place", label: a.location.name };
  if (extras.nextDue != null) facts.nextDue = { kind: "text", label: day(extras.nextDue) };
  if (extras.job) facts.onJob = { kind: "text", label: `${extras.job.number} ${extras.job.name}` };
  return facts;
}

function bulkFacts(a: AssetSource): Record<string, Fact> {
  const facts: Record<string, Fact> = {
    available: { kind: "qty", value: a.availableQuantity ?? 0 },
    total: { kind: "qty", value: a.totalQuantity ?? 0 },
  };
  if (a.model?.name) facts.model = { kind: "text", label: a.model.name };
  if (a.location?.name) facts.location = { kind: "place", label: a.location.name };
  return facts;
}

export function assetRowOf(a: AssetSource, kind: AssetKind, extras: AssetExtras, menu?: ActionMenuSpec): LineRowData {
  const status = a.status ?? (kind === "bulk" ? "ACTIVE" : "AVAILABLE");
  const facts = kind === "bulk" ? bulkFacts(a) : serializedFacts(a, extras);
  if (a.tags?.length) facts.tags = { kind: "text", label: a.tags.join(", ") };
  return {
    id: a.id,
    kind: "gear",
    title: a.assetTag,
    subtitle: [a.customName, a.model?.category?.name].filter(Boolean).join(" · ") || undefined,
    tags: a.tags?.length ? a.tags : undefined,
    facts,
    status: { label: assetStatusLabel(kind, status), intent: getStatusIntent(kind === "bulk" ? "bulkAsset" : "asset", status) },
    menu,
    href: kind === "bulk" ? `/assets/registry/${a.id}?type=bulk` : `/assets/registry/${a.id}`,
  };
}

// ─── Export ──────────────────────────────────────────────────────────────

export const exportFilename = (kind: AssetKind) => (kind === "bulk" ? "bulk-assets.csv" : "assets.csv");
