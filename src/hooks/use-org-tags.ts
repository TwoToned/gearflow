"use client";

import { useEffect, useState } from "react";
import { getOrgTags } from "@/server/tags";

/**
 * Org-wide tag autocomplete suggestions (React Query removal, Phase 6).
 *
 * `getOrgTags` is a read-only aggregate over the `tags` arrays of every taggable
 * entity (model / asset / bulk / kit / location / category / maintenance /
 * project / client). It is autocomplete-only — there is NO liveness requirement
 * and it was never invalidated under React Query — so this is a one-shot fetch
 * on mount (and on org switch) rather than a reactive Convex subscription.
 *
 * Replaces the old `useQuery({ queryKey: ["org-tags", orgId], queryFn: getOrgTags })`
 * datum across the 11 entity forms. Pass `undefined` to skip until org context
 * has loaded.
 */
export function useOrgTags(orgId: string | undefined): string[] {
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    // Clear on org change/unload so we never surface the previous org's tags
    // under a new org (mirrors React Query's per-`["org-tags", orgId]`-key isolation).
    setTags([]);
    if (!orgId) return;
    let cancelled = false;
    getOrgTags()
      .then((next) => {
        if (!cancelled) setTags(next);
      })
      .catch(() => {
        // Autocomplete suggestions are best-effort; ignore fetch failures.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return tags;
}
