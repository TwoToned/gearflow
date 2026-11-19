/**
 * Saved views on a URL-state list (D11). A view's `config` IS the list's query
 * string (`{ query: "seg=out&status=QUOTED" }`): applying one is `router.push`,
 * so a saved view, a bookmark and a dashboard link are the same thing.
 *
 * Rows saved before the URL migration hold `{ filters, sortBy, sortOrder }`;
 * `viewQuery` converts them on READ (no backfill, the stored row is never
 * rewritten until the user updates the view). Anything the list no longer
 * understands is dropped by the codec rather than throwing, so an old view
 * still opens.
 */
import {
  parseListState,
  serializeListState,
  type ListUrlSpec,
  type ListUrlState,
} from "@/lib/list-url-state";
import type { SavedViewConfig } from "@/lib/saved-views";

import { MAX_VIEW_QUERY } from "../../../convex/lib/viewLimits";

/** A view the list ships with: not stored, not deletable, never a default. */
export interface UrlBuiltInView {
  id: string;
  name: string;
  query: string;
}

/** Old filter keys that were renamed when the list moved to URL params. */
export type LegacyKeyAliases = Readonly<Record<string, string>>;

function legacyParams(config: SavedViewConfig, aliases: LegacyKeyAliases): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(config.filters ?? {})) {
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    const strings = list.filter((v): v is string => typeof v === "string" && v !== "");
    if (strings.length > 0) params.set(aliases[key] ?? key, strings.join(","));
  }
  if (config.sortBy) params.set("sort", `${config.sortBy}:${config.sortOrder ?? "asc"}`);
  return params;
}

/**
 * The list's query for a stored view: a URL-mode `query` is re-normalised through
 * the codec (junk dropped), a legacy row is converted. Search text and paging are
 * never part of a view.
 */
export function viewQuery(config: SavedViewConfig | undefined, spec: ListUrlSpec, aliases: LegacyKeyAliases = {}): string {
  const safe = config ?? {};
  const params =
    typeof safe.query === "string" && safe.query.length <= MAX_VIEW_QUERY
      ? new URLSearchParams(safe.query)
      : legacyParams(safe, aliases);
  return queryOf(parseListState(params, spec), spec);
}

/** The query that captures a list state as a view: no search text, no page. */
export function queryOf(state: ListUrlState, spec: ListUrlSpec): string {
  return serializeListState({ ...state, q: "", page: 1 }, spec).toString();
}
