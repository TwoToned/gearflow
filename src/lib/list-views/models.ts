/**
 * The Models list as data (UX unification §9g, Phase 14): segments, filter words, columns, URL
 * spec, query args and the row mapping. Pure: no React, no router, no Convex. The page
 * (`models-list.tsx`) supplies the query and the handlers.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData } from "@/lib/primitives/types";

const SEGMENT_DEFS = [
  { key: "all", label: "All" },
  { key: "stock", label: "With stock" },
  { key: "nostock", label: "No stock" },
  { key: "due", label: "Due for T&T" },
  { key: "archived", label: "Archived" },
] as const;

export const MODELS_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["cat", "type", "tag"],
  sorts: ["name", "category", "assetType", "owned", "available", "dailyRate", "replacementCost"],
  defaultSort: "name:asc",
};

/** The strip: counts come from `modelsList.segmentCounts` (absent while loading). */
export function modelSegments(counts: Record<string, number> | undefined): ListSegment[] {
  return SEGMENT_DEFS.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] }));
}

const TYPES = [
  { value: "SERIALIZED", label: "Serialized" },
  { value: "BULK", label: "Bulk" },
] as const;

export function modelFilters(categories: { id: string; name: string; parentName?: string | null }[], tags: string[]): ListFilterDef[] {
  return [
    { key: "cat", label: "Category", options: categories.map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} → ${c.name}` : c.name })) },
    { key: "type", label: "Type", options: TYPES.map((t) => ({ value: t.value, label: t.label })) },
    { key: "tag", label: "Tags", options: tags.map((t) => ({ value: t, label: t })) },
  ];
}

export const MODEL_ITEM_HEADER = "Model";
export const MODEL_ITEM_SORT_KEY = "name";

/**
 * Owned / Available / Day rate by default. Value (replacement cost) and Type and Tags are opt-in from
 * ⋯ › Columns (D43): cost data is never on by default. Day rate is what the client pays, so it shows.
 */
export const MODEL_COLUMNS: FactColumn[] = [
  { id: "owned", header: "Owned", align: "end", sortKey: "owned" },
  { id: "available", header: "Available", align: "end", sortKey: "available" },
  { id: "dayRate", header: "Day rate", align: "end", sortKey: "dailyRate" },
  { id: "value", header: "Value", align: "end", sortKey: "replacementCost", optional: true },
  { id: "type", header: "Type", sortKey: "assetType", optional: true },
  { id: "tags", header: "Tags", optional: true },
];

/** The URL contract drops unknown values: keep only those in `allowed` (none left = no filter). */
function known(values: string[] | undefined, allowed?: readonly string[]): string[] | undefined {
  const kept = allowed ? values?.filter((v) => allowed.includes(v)) : values;
  return kept && kept.length > 0 ? kept : undefined;
}

export function modelsQueryArgs(state: ListUrlState, now: number) {
  const f = state.filters;
  const due = state.seg === "due";
  return {
    search: state.q.trim() || undefined,
    categoryIdIn: known(f.cat),
    assetTypeIn: known(f.type, TYPES.map((t) => t.value)),
    tagsHasSome: known(f.tag),
    segment: state.seg === "all" ? undefined : state.seg,
    // `now` is only read for the Due segment; keep it out of every other query's key.
    now: due ? now : undefined,
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

/** The fields of a `modelsList.listPage` item the list reads. */
export interface ModelSource {
  id: string;
  name: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
  assetType?: string | null;
  dailyRate?: number | null;
  weeklyRate?: number | null;
  monthlyRate?: number | null;
  replacementCost?: number | null;
  tags?: string[] | null;
  isActive?: boolean | null;
  owned: number;
  available: number;
  category?: { name: string; parentName?: string | null } | null;
  media?: { url: string | null; thumbnailUrl: string | null } | null;
}

/** All three rates set = complete pricing; some = incomplete; none = no mark (the old table's dot). */
export function pricingState(m: Pick<ModelSource, "dailyRate" | "weeklyRate" | "monthlyRate">): "complete" | "incomplete" | "none" {
  const n = [m.dailyRate, m.weeklyRate, m.monthlyRate].filter((r) => r != null).length;
  return n === 3 ? "complete" : n > 0 ? "incomplete" : "none";
}

export function modelRowOf(m: ModelSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = {
    owned: { kind: "qty", value: m.owned },
    available: { kind: "qty", value: m.available, of: m.owned },
    dayRate: { kind: "money", amount: m.dailyRate ?? null },
    value: { kind: "money", amount: m.replacementCost ?? null },
    type: { kind: "text", label: m.assetType === "BULK" ? "Bulk" : "Serialized" },
  };
  if (m.tags?.length) facts.tags = { kind: "text", label: m.tags.join(", ") };
  const category = m.category ? (m.category.parentName ? `${m.category.parentName} → ${m.category.name}` : m.category.name) : null;
  return {
    id: m.id,
    kind: "gear",
    title: m.name,
    subtitle: [category, m.manufacturer, m.modelNumber].filter(Boolean).join(" · ") || undefined,
    facts,
    menu,
    href: `/assets/models/${m.id}`,
  };
}
