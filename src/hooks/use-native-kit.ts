"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import { reconstructKit, type NativeKitDetail } from "@/lib/kit-detail-reconstruct";

/**
 * Native kit detail: ONE `kitDetail.bundle` subscription reconstructs the getKit
 * shape (kit + members + usage + scan logs + media + location/category) client-side
 * — reactive over the WebSocket. Skips unless the flag is on and ids are present.
 */
export function useNativeKit(
  kitId: string | undefined,
  orgId: string | undefined,
): { data: NativeKitDetail | undefined; isLoading: boolean; notFound: boolean } {
  const enabled = !!kitId && !!orgId;
  const bundle = useAuthedQuery(
    api.kitDetail.bundle,
    enabled ? { kitId: kitId!, orgId: orgId! } : "skip",
  );

  const data = useMemo(() => {
    if (!enabled || bundle === undefined) return undefined;
    if (bundle === null) return undefined; // not found / not permitted
    return reconstructKit(bundle);
  }, [enabled, bundle]);

  return {
    data,
    isLoading: enabled && bundle === undefined,
    notFound: enabled && bundle === null,
  };
}
