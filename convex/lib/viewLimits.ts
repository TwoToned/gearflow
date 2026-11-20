/**
 * Bounds of a saved table view's `query` (a URL-state list's query string).
 * Plain module, no Convex imports: read by the write guard in
 * `savedTableViewsWrites.ts` AND by `src/lib/list-views/saved-view-url.ts`, so
 * the client adapter and the server can never disagree (R-3.1).
 */
export const MAX_VIEW_QUERY = 1000;
