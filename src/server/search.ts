"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Global search (Cmd+K palette + MCP `search` tool).
 *
 * Previously a 740-line pure-`pg_trgm` engine running 14 raw `$queryRaw` statements
 * against Postgres. Those domain tables are now FROZEN (Convex is the source of truth
 * after the write-inversion), so the palette returned STALE results — any record
 * created after the inversion never appeared. This is now a thin wrapper over the
 * native Convex query `api.globalSearch.search`, which reproduces the exact match +
 * rank + parent/child assembly backend-local over the LIVE Convex docs in one round
 * trip. See convex/globalSearch.ts + convex/lib/searchScore.ts.
 *
 * The `SearchResult`/`SearchResultType` types stay DECLARED here (not re-exported from
 * the Convex module) because command-search.tsx imports them from this "use server"
 * file, and Next's server-action transform breaks on re-exported type specifiers.
 */

export type SearchResultType =
  | "model"
  | "kit"
  | "asset"
  | "bulk-asset"
  | "project"
  | "client"
  | "supplier"
  | "location"
  | "category"
  | "maintenance"
  | "crew"
  | "check-item"
  | "group-template"
  | "sub-hire";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  href: string;
  relevance: number;
  isChild?: boolean;
  /** Status field for projects (used by warehouse filtering) */
  status?: string;
};

export async function globalSearch(query: string): Promise<{ results: SearchResult[] }> {
  const { organizationId } = await getOrgContext();

  if (!query || query.trim().length < 2) return { results: [] };

  const convex = await getConvexClient();
  const data = await convex.query(api.globalSearch.search, {
    orgId: organizationId,
    query,
  });

  return serialize({ results: data.results as SearchResult[] });
}
