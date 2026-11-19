/**
 * The URL is the state of a list page (spec §9b.2 item 9, D11). Segment,
 * filters, sort, page, search and view are query params, so a saved view is a
 * link, a dashboard tile can link to the segment it counts, and Back works.
 *
 * Pure codec: no React, no router. `useListUrlState` (a thin hook beside the
 * ListPage) feeds it `useSearchParams()` and pushes the result. Defaults are
 * OMITTED from the URL; unknown or invalid params are dropped, never thrown on
 * (a stale bookmark must still open the list).
 */
import { z } from "zod";

export interface ListUrlSpec {
  /** Segment keys, first one is the default (`all`). */
  segments: readonly string[];
  /** Filter keys; each is a comma list of values. */
  filters: readonly string[];
  /** Sortable column keys. */
  sorts: readonly string[];
  /** Default sort, `key:asc|desc`. */
  defaultSort: string;
  /** Allowed `view` values; first one is the default (omitted from the URL). */
  views?: readonly string[];
  /** Page size is fixed at 25 (spec); exported so pagers and queries agree. */
}

export const LIST_PAGE_SIZE = 25;

export interface ListUrlState {
  seg: string;
  q: string;
  filters: Record<string, string[]>;
  sortBy: string;
  sortOrder: "asc" | "desc";
  page: number;
  view: string;
}

const PageSchema = z.coerce.number().int().min(1).max(100000);
const SortSchema = z.string().regex(/^[A-Za-z0-9_]+:(asc|desc)$/);

function splitDefault(def: string): { by: string; order: "asc" | "desc" } {
  const [by, order] = def.split(":");
  return { by, order: order === "desc" ? "desc" : "asc" };
}

function splitList(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

export function defaultListState(spec: ListUrlSpec): ListUrlState {
  const d = splitDefault(spec.defaultSort);
  return {
    seg: spec.segments[0],
    q: "",
    filters: {},
    sortBy: d.by,
    sortOrder: d.order,
    page: 1,
    view: spec.views?.[0] ?? "",
  };
}

export function parseListState(params: URLSearchParams, spec: ListUrlSpec): ListUrlState {
  const state = defaultListState(spec);

  const seg = params.get("seg");
  if (seg && spec.segments.includes(seg)) state.seg = seg;

  const q = params.get("q");
  if (q) state.q = q.slice(0, 200);

  for (const key of spec.filters) {
    const values = splitList(params.get(key));
    if (values.length > 0) state.filters[key] = values;
  }

  const sort = SortSchema.safeParse(params.get("sort"));
  if (sort.success) {
    const [by, order] = sort.data.split(":");
    if (spec.sorts.includes(by)) {
      state.sortBy = by;
      state.sortOrder = order as "asc" | "desc";
    }
  }

  const page = PageSchema.safeParse(params.get("page"));
  if (page.success) state.page = page.data;

  const view = params.get("view");
  if (view && spec.views?.includes(view)) state.view = view;

  return state;
}

/** Defaults are omitted; filter values keep the order they were chosen in. */
export function serializeListState(state: ListUrlState, spec: ListUrlSpec): URLSearchParams {
  const def = defaultListState(spec);
  const out = new URLSearchParams();
  if (state.seg !== def.seg) out.set("seg", state.seg);
  if (state.q.trim()) out.set("q", state.q.trim());
  for (const key of spec.filters) {
    const values = state.filters[key];
    if (values && values.length > 0) out.set(key, values.join(","));
  }
  if (state.sortBy !== def.sortBy || state.sortOrder !== def.sortOrder) {
    out.set("sort", `${state.sortBy}:${state.sortOrder}`);
  }
  if (state.page > 1) out.set("page", String(state.page));
  if (state.view !== def.view) out.set("view", state.view);
  return out;
}

/** Which params a list owns, so a page can keep unrelated params (e.g. `tab`). */
export function listParamKeys(spec: ListUrlSpec): string[] {
  return ["seg", "q", ...spec.filters, "sort", "page", "view"];
}

/** True when the URL carries no list params at all (a saved default may apply). */
export function hasNoListParams(params: URLSearchParams, spec: ListUrlSpec): boolean {
  return listParamKeys(spec).every((k) => !params.has(k));
}

/** A change that narrows or reorders the list resets paging to page 1. */
export function withPatch(
  state: ListUrlState,
  patch: Partial<Omit<ListUrlState, "filters">> & { filters?: Record<string, string[]> },
): ListUrlState {
  const resetsPage = patch.page === undefined;
  return { ...state, ...patch, filters: patch.filters ?? state.filters, page: resetsPage ? 1 : patch.page! };
}

export function setFilter(state: ListUrlState, key: string, values: string[]): ListUrlState {
  const filters = { ...state.filters };
  if (values.length === 0) delete filters[key];
  else filters[key] = values;
  return withPatch(state, { filters });
}

export function hasActiveFilters(state: ListUrlState): boolean {
  return Object.keys(state.filters).length > 0 || state.q.trim() !== "";
}

export function clearFilters(state: ListUrlState): ListUrlState {
  return withPatch(state, { filters: {}, q: "" });
}

/** Clicking the active sort header flips direction; a new one starts ascending. */
export function toggleSort(state: ListUrlState, key: string): ListUrlState {
  if (state.sortBy === key) return withPatch(state, { sortOrder: state.sortOrder === "asc" ? "desc" : "asc" });
  return withPatch(state, { sortBy: key, sortOrder: "asc" });
}
