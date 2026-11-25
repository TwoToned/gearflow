"use client";

import { useCallback } from "react";
import { useConvex } from "convex/react";

import { api } from "../../../convex/_generated/api";

/**
 * One-shot "is this tag already used?" for the asset sheet's inline error
 * (`AURA-03 is already used by another asset`). Returns the message, or `null` when the
 * tag is free (or is the record being edited). The server's duplicate guard stays the
 * authority; this is only the early, as-you-type answer. Serialised units and bulk stock
 * share one tag namespace per org, so both are checked for either kind.
 */
export function useTagTaken(orgId: string | undefined, ownId?: string) {
  const convex = useConvex();
  return useCallback(
    async (tag: string): Promise<string | null> => {
      const t = tag.trim();
      if (!orgId || !t) return null;
      try {
        const [a, b] = await Promise.all([
          convex.query(api.assets.getByAssetTag, { organizationId: orgId, assetTag: t }),
          convex.query(api.bulkAssets.getByAssetTag, { organizationId: orgId, assetTag: t }),
        ]);
        const other = [a, b].find((r) => r && r.id !== ownId);
        return other ? `${t} is already used by another asset` : null;
      } catch {
        return null; // advisory: never block typing on a failed lookup
      }
    },
    [convex, orgId, ownId],
  );
}
