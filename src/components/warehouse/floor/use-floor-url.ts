"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseFloorUrl, serializeFloorUrl, type FloorUrlState } from "@/lib/warehouse-floor";

/**
 * The floor's state lives in the URL (D11), parsed by the one Zod schema in
 * `src/lib/warehouse-floor.ts`. Switching mode pushes a history entry (back
 * returns to the floor); every filter change replaces it.
 */
export function useFloorUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = useMemo(() => parseFloorUrl(params), [params]);
  // Two updates in one tick (a scan rings a card AND the dock clears its text)
  // must compose, not have the second overwrite the first from a stale render.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const update = useCallback(
    (patch: Partial<FloorUrlState>) => {
      const prev = latest.current;
      const next = { ...prev, ...patch };
      latest.current = next;
      const href = `${pathname}${serializeFloorUrl(next)}`;
      if (patch.mode && patch.mode !== prev.mode) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [pathname, router],
  );

  return { state, update };
}
