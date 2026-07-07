"use client";

import { useEffect, useRef } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * Feature flag (default OFF) for the native dashboard-stats read cutover (Phase 3).
 * Inlined at build time — flipping it needs the Dockerfile/build-image build-arg +
 * repo var. Requires the `dashboardCounters` to be backfilled first
 * (`pnpm convex:backfill:dashboard-counters`).
 */
export const NATIVE_DASHBOARD_ENABLED = process.env.NEXT_PUBLIC_NATIVE_DASHBOARD === "true";

const MINUTE = 60_000;
// Counters are maintained per-write in-transaction (convex/lib/counters.ts), so the
// on-view reconcile is now only a DRIFT BACKSTOP — throttle it to a long window
// (≤ once/hour/org) instead of the old per-minute refresh, so the whole-org
// `.collect()` recompute stays off the hot path.
const RECONCILE_BACKSTOP_MS = 60 * MINUTE;

export interface NativeDashboardStats {
  totalAssets: number;
  checkedOutAssets: number;
  activeProjects: number;
  activeCrew: number;
  pendingCrewOffers: number;
  maintenanceDue: number;
  overdueReturns: number;
  countersReady: boolean;
}

/**
 * Native getDashboardStats: the seven dashboard stats from `dashboardStats.bundle`
 * — the six counters read O(1) from `dashboardCounters` + the two date-derived
 * metrics computed at read. Reactive over the WebSocket (re-runs when counters or
 * the date-derived source rows change, and each minute as `now` rolls over).
 *
 * Counters are maintained per-write in-transaction (convex/lib/counters.ts); this
 * hook also fires a THROTTLED `reconcileIfStale` once on mount as a DRIFT BACKSTOP
 * (≤ once/hour/org) so any residual drift self-heals and a brand-new org gets its
 * row — a fresh row is a cheap no-op. Skips unless the flag is on and orgId is known.
 */
export function useNativeDashboardStats(
  orgId: string | undefined,
): { data: NativeDashboardStats | undefined; isLoading: boolean } {
  const enabled = NATIVE_DASHBOARD_ENABLED && !!orgId;
  // Minute-bucketed so the subscription arg is stable within a minute (it refreshes
  // the date-derived metrics each minute) — queries can't read the clock themselves.
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;

  const data = useAuthedQuery(
    api.dashboardStats.bundle,
    enabled ? { orgId: orgId!, now: nowBucket } : "skip",
  ) as NativeDashboardStats | undefined;

  const { isAuthenticated } = useConvexAuth();
  const reconcileIfStale = useMutation(api.dashboardCounters.reconcileIfStale);
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !isAuthenticated || !orgId || firedFor.current === orgId) return;
    firedFor.current = orgId;
    // Best-effort drift backstop: reconcile only if the row is stale by the long
    // backstop window (per-write deltas keep it fresh in between). ≤ once/hour/org.
    void reconcileIfStale({ orgId, now: Date.now(), maxAgeMs: RECONCILE_BACKSTOP_MS }).catch(() => {});
  }, [enabled, isAuthenticated, orgId, reconcileIfStale]);

  return { data, isLoading: enabled && data === undefined };
}

/**
 * The remaining bounded dashboard reads, native (Phase 3): upcoming projects, my
 * home, my blocking comments, recent activity. Each is a reactive useQuery over a
 * Convex composite; the consumers parse dates with `new Date()`, so the queries
 * return epoch-ms. All gated on the same NEXT_PUBLIC_NATIVE_DASHBOARD flag.
 */
export function useNativeUpcoming(orgId: string | undefined) {
  const enabled = NATIVE_DASHBOARD_ENABLED && !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  return useAuthedQuery(api.dashboardLists.upcoming, enabled ? { orgId: orgId!, now: nowBucket } : "skip");
}

export function useNativeHome(orgId: string | undefined) {
  const enabled = NATIVE_DASHBOARD_ENABLED && !!orgId;
  return useAuthedQuery(api.dashboardLists.home, enabled ? { orgId: orgId! } : "skip");
}

export function useNativeBlocking(orgId: string | undefined) {
  const enabled = NATIVE_DASHBOARD_ENABLED && !!orgId;
  return useAuthedQuery(api.dashboardLists.blocking, enabled ? { orgId: orgId! } : "skip");
}

export function useNativeActivity(orgId: string | undefined) {
  const enabled = NATIVE_DASHBOARD_ENABLED && !!orgId;
  return useAuthedQuery(api.dashboardActivity.bundle, enabled ? { orgId: orgId! } : "skip");
}

export interface NativeSubHireStats {
  activeSubHires: number;
  monthlySubHireCost: number;
  overdueReturns: number;
}

/**
 * Native getSubHireDashboardStats: the org's (bounded) sub-hire heads aggregated
 * reactively — no counter needed. `now` is minute-bucketed and `monthStart` is the
 * first of the current month (both client-computed; queries can't read the clock).
 */
export function useNativeSubHireStats(
  orgId: string | undefined,
): NativeSubHireStats | undefined {
  const enabled = NATIVE_DASHBOARD_ENABLED && !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  const monthStart = enabled ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : 0;
  return useAuthedQuery(
    api.dashboardSubHire.bundle,
    enabled ? { orgId: orgId!, now: nowBucket, monthStart } : "skip",
  ) as NativeSubHireStats | undefined;
}
