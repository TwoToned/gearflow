"use client";

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";

export type SupplierCounts = Record<string, { assets: number; orders: number }>;

/**
 * Asset + order counts per supplier (supplierId → { assets, orders }) for the
 * suppliers table — the browser-native replacement for the getSupplierCounts
 * server action (Phase 3 read re-homing).
 *
 * The old datum was a non-reactive `useServerQuery`, and the counts have no
 * liveness requirement, so this is a ONE-SHOT `useConvex().query` on mount /
 * org-switch rather than a reactive org-wide `.collect()` subscription (Appendix
 * B). Gated on Convex auth so a pre-token orgId doesn't reject and stick counts at
 * empty. Returns an empty map until org context loads / while fetching.
 */
export function useSupplierCounts(orgId: string | undefined): SupplierCounts {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [counts, setCounts] = useState<SupplierCounts>({});

  useEffect(() => {
    setCounts({});
    if (!orgId || !isAuthenticated) return;
    let cancelled = false;
    convex
      .query(api.suppliers.counts, { orgId })
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch(() => {
        // Best-effort — a failed count renders 0s in the assets/orders columns.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, isAuthenticated, convex]);

  return counts;
}
