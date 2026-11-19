"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { BulkBar } from "@/components/ui/bulk-bar";
import { Button } from "@/components/ui/button";
import { LineRowList } from "@/components/ui/line-row";
import {
  ListEmpty,
  ListFooter,
  ListHead,
  ListSegments,
  ListSkeleton,
  ListToolbar,
  type ListEmptyCopy,
  type ListFilterDef,
  type ListPrimary,
  type ListSegment,
  type ViewWord,
} from "@/components/ui/list-page-parts";
import { useColumnVisibility } from "@/hooks/use-column-visibility";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  clearFilters,
  hasActiveFilters,
  LIST_PAGE_SIZE,
  serializeListState,
  setFilter,
  toggleSort,
  withPatch,
  type ListUrlSpec,
  type ListUrlState,
} from "@/lib/list-url-state";
import type { ActionItem, ActionMenuSpec, BulkAction, FactColumn, LineRowData, ListSort } from "@/lib/primitives/types";
import { useRowSelection } from "@/lib/primitives/use-row-selection";

/**
 * `ListPage` (UX unification §9b): the one list-page shell. It owns the chrome
 * (title, segments, search, filter words, view words, footer, empty state, the
 * phone's sticky primary) and the URL state (D11: the URL is the state); rows
 * render through `LineRowList` (§13). The page supplies a config and the
 * already-queried rows; it does not own state of its own.
 *
 * Rows for ONE page come in via `rows`; on a phone the page accumulates them
 * (`Show 25 more`) instead of paging. `rows` need not be memoised.
 */

export interface ListPageProps {
  /** A module constant: it keys the URL-state memo. */
  spec: ListUrlSpec;
  title: string;
  /** Plural noun for the footer: "jobs". */
  noun: string;
  /** Singular noun for the bulk bar: "job". */
  bulkNoun: string;
  searchPlaceholder: string;
  segments: ListSegment[];
  filters: ListFilterDef[];
  /** Defaults to Table only; give 2+ to show view words. */
  views?: ViewWord[];
  columns: FactColumn[];
  /** Enables ⋯ › Columns for the `optional` columns; the opt-in is kept in localStorage `colVis[columnsKey]`. */
  columnsKey?: string;
  rows: LineRowData[];
  total: number;
  loading: boolean;
  itemHeader: string;
  itemSortKey?: string;
  leading?: (row: LineRowData) => React.ReactNode;
  primary?: ListPrimary;
  pageMenu?: ActionMenuSpec;
  /** Built from the selected ids (visible rows only). */
  bulk?: (ids: string[]) => BulkAction[];
  empty: ListEmptyCopy;
  /** Trailing toolbar slot: the saved-views menu. */
  toolbarExtra?: React.ReactNode;
  /** A non-table view (`board`): rendered instead of the table; chrome stays. */
  renderView?: (view: string) => React.ReactNode | null;
}

const SEARCH_DEBOUNCE_MS = 200;

/** Local input value, written to the URL with `replace` after a pause, resynced on Back. */
function useDebouncedSearch(state: ListUrlState, setState: (s: ListUrlState, m: "push" | "replace") => void) {
  const [value, setValue] = React.useState(state.q);
  const latest = React.useRef({ state, setState });
  React.useEffect(() => {
    latest.current = { state, setState };
  });
  // Back/Forward changed `q` under us: adopt it (derive-during-render, not an effect).
  const [seenQ, setSeenQ] = React.useState(state.q);
  if (seenQ !== state.q) {
    setSeenQ(state.q);
    setValue(state.q);
  }
  React.useEffect(() => {
    if (value === latest.current.state.q) return;
    const t = setTimeout(() => {
      const { state: s, setState: set } = latest.current;
      set(withPatch(s, { q: value }), "replace");
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);
  return [value, setValue] as const;
}

/** Everything that changes WHICH rows match (not which page), as one string. */
function queryKey(state: ListUrlState, spec: ListUrlSpec): string {
  const p = serializeListState({ ...state, page: 1, view: "" }, { ...spec, views: undefined });
  return p.toString();
}

/** Phone: rows from earlier pages stay on screen as the next page is appended. */
function useAccumulatedRows(rows: LineRowData[], resetKey: string, enabled: boolean) {
  const [prior, setPrior] = React.useState<{ key: string; rows: LineRowData[] }>({ key: "", rows: [] });
  const priorRows = enabled && prior.key === resetKey ? prior.rows : [];
  const seen = new Set(priorRows.map((r) => r.id));
  const combined = [...priorRows, ...rows.filter((r) => !seen.has(r.id))];
  const keep = () => setPrior({ key: resetKey, rows: combined });
  return { rows: combined, keep };
}

/** The phone's primary: fixed above the bottom nav, replaced by BulkBar while rows are selected. */
function StickyPrimary({ primary }: { primary: ListPrimary }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-x-3 z-30"
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
    >
      <Button className="w-full" onClick={primary.onSelect}>
        {primary.label}
      </Button>
    </div>,
    document.body,
  );
}

function useSortProps(state: ListUrlState, setState: (s: ListUrlState) => void) {
  const sort: ListSort = { key: state.sortBy, dir: state.sortOrder };
  const onSort = (key: string) => setState(toggleSort(state, key));
  return { sort, onSort };
}

/** State, accumulated rows and selection for one ListPage render. */
function useListController(props: ListPageProps) {
  const isMobile = useIsMobile();
  const { state, setState } = useListUrlState(props.spec);
  const [search, setSearch] = useDebouncedSearch(state, setState);
  const { sort, onSort } = useSortProps(state, setState);
  const resetKey = queryKey(state, props.spec);
  const { rows, keep } = useAccumulatedRows(props.rows, resetKey, isMobile);
  const ids = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const selection = useRowSelection(ids);
  const clearSelection = selection.clear;
  React.useEffect(() => {
    clearSelection();
  }, [resetKey, clearSelection]);
  const showMore = (page: number) => {
    if (isMobile) keep();
    setState(withPatch(state, { page }), isMobile ? "replace" : "push");
  };
  const clear = () => setState(clearFilters(state));
  return { isMobile, state, setState, search, setSearch, sort, onSort, rows, ids, selection, showMore, clear };
}

type Controller = ReturnType<typeof useListController>;

function ListBody({ props, c }: { props: ListPageProps; c: Controller }) {
  const { rows } = c;
  return (
    <>
      {props.loading && rows.length === 0 && <ListSkeleton />}
      {!props.loading && rows.length === 0 && (
        <ListEmpty filtered={hasActiveFilters(c.state)} none={props.empty} onClear={c.clear} />
      )}
      {rows.length > 0 && (
        <LineRowList
          rows={rows}
          columns={props.columns}
          selection={c.selection}
          itemHeader={props.itemHeader}
          itemSortKey={props.itemSortKey}
          sort={c.sort}
          onSort={c.onSort}
          leading={props.leading}
        />
      )}
      <ListFooter
        total={props.total}
        page={c.state.page}
        pageSize={LIST_PAGE_SIZE}
        shown={rows.length}
        noun={props.noun}
        onPage={c.showMore}
      />
    </>
  );
}

/** The BulkBar while rows are selected; on a phone the sticky primary otherwise. */
function ListAction({ props, c }: { props: ListPageProps; c: Controller }) {
  const { selection, ids } = c;
  if (selection.count > 0 && props.bulk) {
    const selected = ids.filter((id) => selection.selected.has(id));
    return <BulkBar selection={selection} actions={props.bulk(selected)} noun={props.bulkNoun} />;
  }
  if (c.isMobile && props.primary && selection.count === 0) return <StickyPrimary primary={props.primary} />;
  return null;
}

/** The page ⋯ with ⋯ › Columns merged in (only when the list has optional columns). */
function withColumnsItem(menu: ActionMenuSpec | undefined, item: ActionItem | undefined): ActionMenuSpec | undefined {
  if (!item) return menu;
  return { items: [...(menu?.items ?? []), item] };
}

export function ListPage(props: ListPageProps) {
  const cols = useColumnVisibility(props.columnsKey, props.columns);
  const c = useListController({ ...props, columns: cols.columns });
  const { state, setState } = c;
  const view = props.renderView?.(state.view) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <ListHead title={props.title} primary={props.primary} pageMenu={withColumnsItem(props.pageMenu, cols.item)} />
      {props.segments.length > 0 && (
        <ListSegments segments={props.segments} value={state.seg} onChange={(seg) => setState(withPatch(state, { seg }))} />
      )}
      <ListToolbar
        search={c.search}
        onSearch={c.setSearch}
        placeholder={props.searchPlaceholder}
        filters={props.filters}
        chosen={state.filters}
        onFilter={(k, v) => setState(setFilter(state, k, v))}
        canClear={props.filters.length > 0 && hasActiveFilters(state)}
        onClear={c.clear}
        views={props.views}
        view={state.view}
        onView={(v) => setState(withPatch(state, { view: v }))}
        extra={props.toolbarExtra}
      />
      {view ?? <ListBody props={{ ...props, columns: cols.columns }} c={c} />}
      <ListAction props={props} c={c} />
    </div>
  );
}
