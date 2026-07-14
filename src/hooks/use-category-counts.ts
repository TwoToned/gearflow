"use client";

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";

export type CategoryCounts = Record<string, { models: number; kits: number }>;

/**
 * Per-category model + kit counts (categoryId → { models, kits }) for the category
 * manager — the browser-native replacement for the getCategoryCounts server action
 * (Phase 3 read re-homing).
 *
 * The old datum was a non-reactive `useServerQuery`, and the counts have no
 * liveness requirement, so this is a ONE-SHOT `useConvex().query` on mount /
 * org-switch rather than a reactive org-wide `.collect()` subscription (Appendix
 * B). Gated on Convex auth so a pre-token orgId doesn't reject and stick counts at
 * empty. Returns an empty map until org context loads / while fetching.
 */
export function useCategoryCounts(orgId: string | undefined): CategoryCounts {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [counts, setCounts] = useState<CategoryCounts>({});

  useEffect(() => {
    setCounts({});
    if (!orgId || !isAuthenticated) return;
    let cancelled = false;
    convex
      .query(api.categories.counts, { orgId })
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch(() => {
        // Best-effort — a failed count renders 0s in the models/kits columns.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, isAuthenticated, convex]);

  return counts;
}
