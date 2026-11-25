"use client";

import { useMemo } from "react";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { assetHealth } from "../../../../convex/lib/assetHealth";
import { api } from "../../../../convex/_generated/api";
import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";
import { buildHealthInput } from "@/lib/asset-health-input";
import { countOverlappingBookings } from "@/lib/asset-bookings";

const DAY = 86_400_000;
const LOOKAHEAD_DAYS = 365;

/**
 * The asset's health, derived on read (`assetHealth`): the bundle's server facts plus the
 * one client-read fact, double bookings, from `availability.assetBookings` over the next
 * year. The window comes from the stable now, rounded to the day, so the query's args
 * (its subscription key) never change between renders. Until the bookings land that row
 * is `unknown` (`not checked`), never clear.
 */
export function useAssetHealth(asset: NativeAssetDetail | undefined, orgId: string | undefined) {
  const now = useStableNow();
  const startMs = Math.floor(now / DAY) * DAY;
  const bookings = useAuthedQuery(
    api.availability.assetBookings,
    asset && orgId ? { orgId, assetId: asset.id, startMs, endMs: startMs + LOOKAHEAD_DAYS * DAY } : "skip",
  );
  return useMemo(() => {
    if (!asset) return undefined;
    const clashes = bookings === undefined ? null : countOverlappingBookings(bookings);
    return assetHealth(buildHealthInput(asset, now, clashes));
  }, [asset, bookings, now]);
}
