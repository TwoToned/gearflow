"use client";

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";

export type KitCounts = Record<
  string,
  { serializedItems: number; bulkItems: number; media: { url: string | null; thumbnailUrl: string | null } | null }
>;

/**
 * Per-kit member counts + primary photo (kitId → { serializedItems, bulkItems,
 * media }) for the kits table — the browser-native replacement for the
 * getKitCounts server action (Phase 3 read re-homing).
 *
 * The old datum was a non-reactive `useServerQuery`, and it reads org-wide member
 * + media tables, so this is a ONE-SHOT `useConvex().query` on mount / org-switch
 * rather than a reactive org-wide `.collect()` subscription (Appendix B). Gated on
 * Convex auth so a pre-token orgId doesn't reject and stick counts at empty.
 */
export function useKitCounts(orgId: string | undefined): KitCounts {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [counts, setCounts] = useState<KitCounts>({});

  useEffect(() => {
    setCounts({});
    if (!orgId || !isAuthenticated) return;
    let cancelled = false;
    convex
      .query(api.kits.counts, { orgId })
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
