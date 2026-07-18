/**
 * Pagination + bounded-read policy for Convex reads (POLICY.md R-9.8, threshold T-24).
 *
 * R-9.8: reads on growable tables must be bounded, never an unbounded full-collection
 * scan that can hold a connection / blow memory as data grows. `.collect()` reads the
 * ENTIRE result set; on a table that grows without bound per org (assets, records,
 * time entries, activity…) that is the hazard.
 *
 * These are the registered defaults (T-24). Page-based list endpoints should clamp their
 * incoming `pageSize` to [1, MAX_PAGE_SIZE] and default to DEFAULT_PAGE_SIZE. Full-list
 * reads on growable tables that genuinely need "all rows for this org" should use
 * `collectCapped` so a pathological row count can't scan unbounded.
 */

/** Default page size for list endpoints when the caller doesn't specify one. */
export const DEFAULT_PAGE_SIZE = 50;

/** Hard ceiling for a caller-supplied page size — clamp requests to this. */
export const MAX_PAGE_SIZE = 200;

/**
 * Safety cap for "read all rows for this org" collection reads on growable tables.
 * Well above any realistic single-org working set, but bounded so one query can never
 * scan without limit. Hitting it means the surface should move to real pagination.
 */
export const COLLECT_HARD_CAP = 10_000;

/** Clamp a caller-supplied page size into [1, MAX_PAGE_SIZE], defaulting when absent. */
export function clampPageSize(requested: number | undefined): number {
  if (!requested || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}

/** A Convex query stream that supports `.take()` (OrderedQuery / Query). */
interface Takeable<T> {
  take(n: number): Promise<T[]>;
}

/**
 * Bounded replacement for `.collect()` on a growable table (R-9.8). Reads at most `cap`
 * rows. Returns `{ rows, truncated }` so callers can tell when the cap was hit (and
 * should paginate) instead of silently trusting a partial set.
 */
export async function collectCapped<T>(
  query: Takeable<T>,
  cap: number = COLLECT_HARD_CAP,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows = await query.take(cap + 1);
  if (rows.length > cap) {
    return { rows: rows.slice(0, cap), truncated: true };
  }
  return { rows, truncated: false };
}
