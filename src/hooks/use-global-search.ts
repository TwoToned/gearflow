"use client";

import { useCallback } from "react";
import { useConvex } from "convex/react";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { SearchResult } from "@/lib/search-types";
import type { SearchGroupTotal } from "@/lib/palette/model";

export interface GlobalSearchResponse {
  results: SearchResult[];
  /** Per-type match counts before the per-type limit (`Show all n in X ›`). */
  groups: SearchGroupTotal[];
}

/**
 * Browser-direct global search (Phase 3 — replaces the `globalSearch` server action).
 * The command palette calls this IMPERATIVELY (debounced on keystroke), so it uses
 * `useConvex().query` (one-shot) rather than a reactive subscription. The Convex query
 * `api.globalSearch.search` is browser-callable (`requireOrgRead`) and drops every
 * result type the caller's role can't read (UX Phase 11, Q4). Same 2-char-min guard.
 */
export function useGlobalSearch(): (query: string) => Promise<GlobalSearchResponse> {
  const convex = useConvex();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  return useCallback(
    async (query: string): Promise<GlobalSearchResponse> => {
      if (!orgId || !query || query.trim().length < 2) return { results: [], groups: [] };
      const data = await convex.query(api.globalSearch.search, { orgId, query });
      return { results: data.results as SearchResult[], groups: data.groups };
    },
    [convex, orgId],
  );
}
