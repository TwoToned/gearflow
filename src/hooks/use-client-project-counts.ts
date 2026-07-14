"use client";

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Project-count-per-client map (clientId → count) for the clients table's
 * "Projects" column — the browser-native replacement for the getClientProjectCounts
 * server action (Phase 3 read re-homing).
 *
 * The old datum was a non-reactive `useServerQuery` (no refetchInterval), and the
 * counts have no liveness requirement, so this is a ONE-SHOT `useConvex().query`
 * on mount / org-switch rather than a reactive org-wide `.collect()` subscription
 * (Appendix B). Returns an empty map until org context has loaded / while fetching.
 */
export function useClientProjectCounts(orgId: string | undefined): Record<string, number> {
  const convex = useConvex();
  // Gate on the Convex token being attached: if orgId resolves before auth does,
  // requireOrgRead would reject and — since we swallow the error and never poll —
  // the counts would stick at zero. isAuthenticated flips true once the token
  // attaches, re-running the effect (the clients table is a post-login landing).
  const { isAuthenticated } = useConvexAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    // Clear on org change so we never surface the previous org's counts.
    setCounts({});
    if (!orgId || !isAuthenticated) return;
    let cancelled = false;
    convex
      .query(api.clients.projectCounts, { orgId })
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch(() => {
        // Best-effort — a failed count just renders 0 in the column.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, isAuthenticated, convex]);

  return counts;
}
