"use client";

import { useMemo } from "react";

export interface PaginatedTableResult<Row> {
  data: Row[];
  total: number;
  totalPages: number;
  isLoading: boolean;
}

/**
 * Derives the {data, total, totalPages, isLoading} shape every paginated
 * registry table (assets, projects, kits, crew, clients, suppliers, …) needs
 * from a `listPage`-style Convex query result — `{items, total, page,
 * pageSize, totalPages}` (see convex/lib/listQuery.ts `paginateItems`) or
 * `undefined` while the subscription is still loading/skipped.
 *
 * Call `useAuthedQuery(api.x.listPage, args)` yourself (it's one line, and
 * its generic signature doesn't wrap cleanly) and pass the result straight
 * in — this hook only centralizes the "undefined while loading → empty
 * defaults" derivation every table hand-rolled separately before it existed.
 * See docs/designs/perf-convex-efficiency-2026-06.md Finding #1.
 */
export function usePaginatedTableResult<Row>(
  page: { items: Row[]; total: number; totalPages: number } | undefined,
): PaginatedTableResult<Row> {
  return useMemo(() => {
    if (page === undefined) return { data: [], total: 0, totalPages: 0, isLoading: true };
    return { data: page.items, total: page.total, totalPages: page.totalPages, isLoading: false };
  }, [page]);
}
