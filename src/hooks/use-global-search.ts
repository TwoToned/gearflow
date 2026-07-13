"use client";

import { useCallback } from "react";
import { useConvex } from "convex/react";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import type { SearchResult } from "@/lib/search-types";

/**
 * Browser-direct global search (Phase 3 — replaces the `globalSearch` server action).
 * The command palette calls this IMPERATIVELY (debounced on keystroke), so it uses
 * `useConvex().query` (one-shot) rather than a reactive subscription. The Convex query
 * `api.globalSearch.search` is browser-callable (`requireOrgRead`). Same 2-char-min
 * guard + `{ results }` shape as the old server action.
 */
export function useGlobalSearch(): (query: string) => Promise<{ results: SearchResult[] }> {
  const convex = useConvex();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  return useCallback(
    async (query: string): Promise<{ results: SearchResult[] }> => {
      if (!orgId || !query || query.trim().length < 2) return { results: [] };
      const data = await convex.query(api.globalSearch.search, { orgId, query });
      return { results: data.results as SearchResult[] };
    },
    [convex, orgId],
  );
}
