"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import { reconstructAsset, type NativeAssetDetail } from "@/lib/asset-detail-reconstruct";

/**
 * Native asset detail: ONE `assetDetail.bundle` subscription reconstructs the
 * getAsset shape (asset + model/category/supplier/parent/location + media +
 * children + usage + maintenance + test-tag) client-side — reactive over the
 * WebSocket. Skips unless the flag is on and ids are present.
 */
export function useNativeAsset(
  assetId: string | undefined,
  orgId: string | undefined,
): { data: NativeAssetDetail | undefined; isLoading: boolean; notFound: boolean } {
  const enabled = !!assetId && !!orgId;
  const bundle = useAuthedQuery(
    api.assetDetail.bundle,
    enabled ? { assetId: assetId!, orgId: orgId! } : "skip",
  );

  const data = useMemo(() => {
    if (!enabled || bundle === undefined) return undefined;
    if (bundle === null) return undefined; // not found / not permitted
    return reconstructAsset(bundle);
  }, [enabled, bundle]);

  return {
    data,
    isLoading: enabled && bundle === undefined,
    notFound: enabled && bundle === null,
  };
}
