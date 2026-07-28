"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

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
  /** WS6 #945 — distinct models with an open, due recurring-PM cycle. Separate
   *  from `maintenanceDue` (which excludes schedule-generated records). */
  modelsDueForService: number;
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
  const enabled = !!orgId;
  // Minute-bucketed so the subscription arg is stable within a minute (it refreshes
  // the date-derived metrics each minute) — queries can't read the clock themselves.
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;

  const raw = useAuthedQuery(
    api.dashboardStats.bundle,
    enabled ? { orgId: orgId!, now: nowBucket } : "skip",
  ) as NativeDashboardStats | undefined;
  // `countersReady === false` means the sharded counters aren't seeded yet (a brand-new
  // org, or the one-time gate-#3 migration window on a legacy row) — the counts would be
  // wrong-zeros. Treat that as still-loading (StatTiles show skeletons) rather than
  // surfacing zeros; the reconcileIfStale effect below seeds them and the reactive query
  // re-runs with real values. A reconciled empty org has countersReady=true (legit zeros).
  const data = raw?.countersReady === false ? undefined : raw;

  const { isAuthenticated } = useConvexAuth();
  const reconcileIfStale = useMutation(api.dashboardCounters.reconcileIfStale);
  // Retry counter (a dep of the effect) so a FAILED backstop reconcile can be
  // re-attempted — otherwise a transient failure on an UNSEEDED org would leave the
  // dashboard stuck on skeletons (countersReady never flips). A seeded org resolves
  // on the first success and never re-fires.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !isAuthenticated || !orgId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Best-effort drift backstop: reconcile only if the row is stale by the long
    // backstop window (per-write deltas keep it fresh in between), OR the shards are
    // unseeded (self-heals the gate-#3 migration on first view). ≤ once/hour/org.
    void reconcileIfStale({ orgId, now: Date.now(), maxAgeMs: RECONCILE_BACKSTOP_MS }).catch(() => {
      if (retry < 3) timer = setTimeout(() => setRetry((n) => n + 1), 4000);
    });
    // Clear the pending retry on unmount / dep change (no setState after unmount).
    return () => {
      if (timer) clearTimeout(timer);
    };
    // `retry` is intentionally a dep: bumping it re-runs the backstop after a failure.
  }, [enabled, isAuthenticated, orgId, reconcileIfStale, retry]);

  return { data, isLoading: enabled && data === undefined };
}

/**
 * The remaining bounded dashboard reads, native (Phase 3): upcoming projects, my
 * home, my blocking comments, recent activity. Each is a reactive useQuery over a
 * Convex composite; the consumers parse dates with `new Date()`, so the queries
 * return epoch-ms.
 */
export function useNativeUpcoming(orgId: string | undefined) {
  const enabled = !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  return useAuthedQuery(api.dashboardLists.upcoming, enabled ? { orgId: orgId!, now: nowBucket } : "skip");
}

export function useNativeHome(orgId: string | undefined) {
  const enabled = !!orgId;
  return useAuthedQuery(api.dashboardLists.home, enabled ? { orgId: orgId! } : "skip");
}

export function useNativeBlocking(orgId: string | undefined) {
  const enabled = !!orgId;
  return useAuthedQuery(api.dashboardLists.blocking, enabled ? { orgId: orgId! } : "skip");
}

export function useNativeActivity(orgId: string | undefined) {
  const enabled = !!orgId;
  return useAuthedQuery(api.dashboardActivity.bundle, enabled ? { orgId: orgId! } : "skip");
}

export interface NativeMyOpenTask {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "NORMAL" | "HIGH";
  dueDate: number | null;
  overdue: boolean;
  projectId: string;
  projectName: string;
  projectNumber: string;
  assigneeUserId: string | null;
  assigneeCrewId: string | null;
}

/**
 * projectTasks.myOpenTasks: this user's open tasks across every project
 * (direct + crew assignment), sorted overdue → due asc → undated last →
 * priority, bounded to 100. Backs both the `/my-tasks` page and the
 * dashboard's My work tasks-due block. Minute-bucketed `now`, same
 * convention as the rest of this file (queries can't read the clock).
 */
export function useNativeMyOpenTasks(orgId: string | undefined) {
  const enabled = !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  return useAuthedQuery(
    api.projectTasks.myOpenTasks,
    enabled ? { orgId: orgId!, now: nowBucket } : "skip",
  ) as NativeMyOpenTask[] | undefined;
}

export interface NativeOverbookingCounts {
  hardCount: number;
  pencilledCount: number;
  saleStockCount: number;
}

/**
 * overbookingBoard.counts: the three Overbookings & Gaps dashboard-chip counts
 * (WS3 #942) — hard overbookings, pencilled collisions, sale stock to
 * procure — over the board's default 30-day horizon (the dashboard has no
 * range picker; open `/overbookings` for that). Deliberately the CHEAP counts
 * query, not the full `bundle` subscription the board page uses — a chip
 * needs three numbers, not every row.
 */
const DAY_MS = 24 * 60 * MINUTE;

export function useNativeOverbookingCounts(orgId: string | undefined): NativeOverbookingCounts | undefined {
  const enabled = !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  const rangeEnd = enabled ? nowBucket + 30 * DAY_MS : 0;
  return useAuthedQuery(
    api.overbookingBoard.counts,
    enabled ? { orgId: orgId!, rangeStart: nowBucket, rangeEnd } : "skip",
  ) as NativeOverbookingCounts | undefined;
}

export interface NativeOrgFinanceCounts {
  quotesOutCount: number;
  expiringCount: number;
  neverSentCount: number;
  confirmedUninvoicedCount: number;
  depositDueCount: number;
  outstandingCount: number;
}

/**
 * financeOrg.counts: the org-level Finance section's dashboard-chip counts
 * (#992, Phase F) — same bounded reads `financeOrg.bundle` uses, small return
 * shape, mirroring `useNativeOverbookingCounts` above.
 */
export function useNativeOrgFinanceCounts(orgId: string | undefined): NativeOrgFinanceCounts | undefined {
  const enabled = !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  return useAuthedQuery(
    api.financeOrg.counts,
    enabled ? { orgId: orgId!, now: nowBucket } : "skip",
  ) as NativeOrgFinanceCounts | undefined;
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
  const enabled = !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  const monthStart = enabled ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : 0;
  return useAuthedQuery(
    api.dashboardSubHire.bundle,
    enabled ? { orgId: orgId!, now: nowBucket, monthStart } : "skip",
  ) as NativeSubHireStats | undefined;
}
