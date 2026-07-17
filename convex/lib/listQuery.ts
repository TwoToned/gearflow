/**
 * Shared primitives for the org registry "listPage" queries (assets,
 * bulkAssets, projects, kits, crewMembers, clients, suppliers, …) — one query
 * per table (Convex needs the literal table name + each entity has its own
 * filter dimensions/joins, so the `query()` definitions stay per-file), but
 * the sort/search/paginate boilerplate every one of them needs is identical
 * and was duplicated per file (aCompare/aMatchesSearch in assets.ts,
 * bulkCompare/bulkMatchesSearch in bulkAssets.ts, …) before this module.
 * See docs/designs/perf-convex-efficiency-2026-06.md Finding #1.
 */

/** Case-insensitive substring match against any of the given haystacks. */
export function matchesSearch(haystacks: (string | null | undefined)[], search: string): boolean {
  const needle = search.toLowerCase();
  return haystacks.some((h) => (h ?? "").toLowerCase().includes(needle));
}

/**
 * Null-safe, type-aware comparator for one sort key + direction. A null is
 * treated as the maximum value (sorts last ascending, first descending —
 * consistent within a direction, matches every table's prior local
 * aCompare/bulkCompare, consolidated here byte-for-byte).
 */
export function compareValues(av: unknown, bv: unknown, dir: 1 | -1): number {
  const aNull = av == null, bNull = bv == null;
  if (aNull && bNull) return 0;
  if (aNull) return dir === 1 ? 1 : -1;
  if (bNull) return dir === 1 ? -1 : 1;
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
  if (typeof av === "boolean" && typeof bv === "boolean") return ((av ? 1 : 0) - (bv ? 1 : 0)) * dir;
  return String(av).localeCompare(String(bv)) * dir;
}

export interface PaginatedPage<Row> {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Slice a pre-filtered + pre-sorted array into one page, with the pagination
 *  metadata every listPage query returns. */
export function paginateItems<Row>(sorted: Row[], page: number, pageSize: number): PaginatedPage<Row> {
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
