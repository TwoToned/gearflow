"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useServerQuery } from "@/hooks/use-server-query";
import { getEquipmentClientView } from "@/server/equipment-client-view";

/** The Equipment tab's two views (spec §7: `List · Client view`). */
export type EquipmentView = "list" | "client";

/** The view, kept in the URL as `?view=client` (absent = List, D11). */
export function useEquipmentViewParam(): { value: EquipmentView; set: (next: EquipmentView) => void } {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value: EquipmentView = searchParams.get("view") === "client" ? "client" : "list";
  const set = useCallback(
    (next: EquipmentView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "client") params.set("view", "client");
      else params.delete("view");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  return { value, set };
}

/** Coalesces a burst of edits (typing a price, a drag) into one re-read. */
const REFRESH_DEBOUNCE_MS = 400;

/**
 * The Equipment tab's Client view: `getEquipmentClientView` for the viewed
 * version, fetched only while the view is open (`enabled`).
 *
 * It is a server-action read (the quote's own chain is Next-side), so it does
 * not push. `source` is any value whose identity changes when the tab's
 * reactive data changes (the caller memoizes it on its Convex trees): each
 * change re-reads the view after a short debounce, keeping the previous result
 * on screen meanwhile, so another user's edit shows up without a reload.
 */
export function useEquipmentClientView({
  projectId,
  versionId,
  enabled,
  source,
}: {
  projectId: string;
  versionId?: string;
  enabled: boolean;
  source: unknown;
}) {
  const query = useServerQuery({
    queryKey: ["equipment-client-view", projectId, versionId ?? null],
    queryFn: () => getEquipmentClientView({ projectId, versionId }),
    enabled,
  });
  const { refetch } = query;

  const seen = useRef(source);
  useEffect(() => {
    if (source === seen.current) return;
    seen.current = source;
    // Closed: the next open fetches fresh anyway.
    if (!enabled) return;
    const timer = setTimeout(refetch, REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, source, refetch]);

  return query;
}
