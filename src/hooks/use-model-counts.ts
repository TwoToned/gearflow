"use client";

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";

export type ModelCounts = Record<
  string,
  { assets: number; bulkAssets: number; media: { url: string | null; thumbnailUrl: string | null } | null }
>;

/**
 * Per-model active asset + bulk-asset counts + primary photo (modelId → { assets,
 * bulkAssets, media }) for the models table — the browser-native replacement for
 * the getModelCounts server action (Phase 3 read re-homing).
 *
 * The old datum was a non-reactive `useServerQuery`, and it reads three org-wide
 * tables (assets/bulkAssets/modelMedia) + file point-reads, so this is a ONE-SHOT
 * `useConvex().query` on mount / org-switch rather than a reactive org-wide
 * `.collect()` subscription (Appendix B). Gated on Convex auth so a pre-token
 * orgId doesn't reject and stick counts at empty.
 */
export function useModelCounts(orgId: string | undefined): ModelCounts {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [counts, setCounts] = useState<ModelCounts>({});

  useEffect(() => {
    setCounts({});
    if (!orgId || !isAuthenticated) return;
    let cancelled = false;
    convex
      .query(api.models.counts, { orgId })
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch(() => {
        // Best-effort — a failed count renders 0s + no thumbnail.
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, isAuthenticated, convex]);

  return counts;
}
