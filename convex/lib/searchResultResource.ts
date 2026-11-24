import type { QueryCtx } from "../_generated/server";
import { callerMayRead } from "./auth";
import type { Resource } from "./permissionsCore";

/**
 * Which RBAC resource a global-search result type belongs to (UX Phase 11, Q4).
 * The ONE table both `globalSearch.search` and `paletteRecents.resolve` filter
 * through, so a role sees a result in the palette exactly when it could open
 * that type's own read. The resources are the ones each type's list/detail read
 * already guards on (`requireOrgReadFor(ctx, orgId, <resource>)`): categories
 * read under `model`, group templates under `project`.
 */
export const SEARCH_RESULT_RESOURCE = {
  model: "model",
  kit: "kit",
  asset: "asset",
  "bulk-asset": "bulkAsset",
  project: "project",
  client: "client",
  supplier: "supplier",
  location: "location",
  category: "model",
  maintenance: "maintenance",
  crew: "crew",
  "check-item": "checkItem",
  "group-template": "project",
  "sub-hire": "subHire",
} as const satisfies Record<string, Resource>;

export type SearchResultType = keyof typeof SEARCH_RESULT_RESOURCE;

const SEARCH_RESULT_TYPES =Object.keys(SEARCH_RESULT_RESOURCE) as SearchResultType[];

/**
 * Drop every result whose type the role can't read, from a flat parent-then-
 * children list. A dropped parent takes its children with it (they are only
 * reachable through it); a kept parent keeps only the children the role reads.
 */
export function filterReadable<R extends { type: SearchResultType; isChild?: boolean }>(
  sorted: R[],
  readable: ReadonlySet<SearchResultType>,
): R[] {
  const out: R[] = [];
  let parentKept = false;
  for (const r of sorted) {
    if (!r.isChild) parentKept = readable.has(r.type);
    if (parentKept && readable.has(r.type)) out.push(r);
  }
  return out;
}

/**
 * The result types the caller's role may read in `orgId`, resolved once per
 * distinct resource through `callerMayRead` (the existing role check). The
 * call's own org guard must already have passed.
 */
export async function readableSearchTypes(ctx: QueryCtx, orgId: string): Promise<Set<SearchResultType>> {
  const resources = [...new Set(Object.values(SEARCH_RESULT_RESOURCE))];
  const allowed = await Promise.all(resources.map((r) => callerMayRead(ctx, orgId, r)));
  const readable = new Set(resources.filter((_, i) => allowed[i]));
  return new Set(SEARCH_RESULT_TYPES.filter((t) => readable.has(SEARCH_RESULT_RESOURCE[t])));
}
