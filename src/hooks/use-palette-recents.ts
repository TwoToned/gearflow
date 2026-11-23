"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { readRecents, writeRecents, pushRecent } from "@/lib/palette/recents";
import { recordRow, type PaletteRow } from "@/lib/palette/model";
import type { RecentRef } from "../../convex/lib/paletteRecentRefs";
import { api } from "../../convex/_generated/api";

/**
 * The palette's Recent group (Q7): ids from localStorage for THIS (org, user),
 * resolved to rows by `paletteRecents.resolve` (org- and role-checked on the
 * server). Read once when the palette opens (the body mounts per open and per
 * org, so an org switch can never show the old org's list). A ref that no
 * longer resolves is simply not shown.
 */
export function usePaletteRecents(orgId: string | undefined, userId: string | undefined) {
  const [refs, setRefs] = useState<RecentRef[]>(() => (orgId && userId ? readRecents(orgId, userId) : []));
  const resolved = useAuthedQuery(api.paletteRecents.resolve, orgId && refs.length > 0 ? { orgId, refs } : "skip");

  const rows = useMemo((): PaletteRow[] => (resolved ?? []).map((r) => recordRow({ ...r, isChild: false })), [resolved]);

  /** Opening a row moves it to the top of Recent. */
  const record = useCallback(
    (ref: RecentRef) => {
      if (!orgId || !userId) return;
      const next = pushRecent(readRecents(orgId, userId), ref);
      writeRecents(orgId, userId, next);
      setRefs(next);
    },
    [orgId, userId],
  );

  return { rows, record };
}
