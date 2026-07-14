"use client";

import { useEffect, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { ReservationConflict } from "@/lib/reservation-conflicts-types";

/**
 * Browser-direct shared store for a project's reservation conflicts (Phase 3 — replaces
 * the getProjectConflicts server action). Read by the conflicts banner (parent) and
 * refreshed by the nested SwapPicker (child) after a swap, so a swap that resolves a
 * conflict drops it from the parent's list — the cross-component invalidate the old
 * shared store gave, now over a browser-direct Convex query.
 *
 * One-shot (NOT a reactive subscription): conflict detection scans the org's whole
 * booking graph, so a reactive `useQuery` would re-run on every org write (Appendix B).
 * The banner has no liveness need — its only refresh trigger is a same-app swap, handled
 * by the child calling `refreshProjectConflicts`.
 *
 * The app's authenticated Convex client is component-local (created in the provider), so
 * it's captured here into a module ref for the module-level `refresh()` the child calls.
 * It's a stable singleton for the app session.
 */

type ConvexClient = ReturnType<typeof useConvex>;
// Mutable holder (not a reassigned `let` — that trips the React Compiler no-reassign
// rule): the app's authenticated Convex client is stamped here from inside the hook's
// effect so the module-level refresh() the child SwapPicker calls can reach it.
const clientHolder: { current: ConvexClient | null } = { current: null };

interface Store {
  data: ReservationConflict[] | undefined;
  subs: Set<() => void>;
  inFlight: boolean;
  /** Monotonic request id — only the latest fetch's result is applied. */
  seq: number;
}
const stores = new Map<string, Store>();

function storeFor(key: string): Store {
  let s = stores.get(key);
  if (!s) {
    s = { data: undefined, subs: new Set(), inFlight: false, seq: 0 };
    stores.set(key, s);
  }
  return s;
}

/**
 * Always issue a FRESH query (never coalesce into an in-flight one — a refresh
 * triggered by a later swap must reflect that swap, not an earlier request's
 * pre-swap snapshot). A monotonic seq ensures only the latest result is applied, so
 * out-of-order completions can't clobber newer data.
 */
function doFetch(projectId: string): void {
  const client = clientHolder.current;
  if (!client) return;
  const s = storeFor(projectId);
  const mySeq = ++s.seq;
  s.inFlight = true;
  void client
    .query(api.reservationConflicts.projectConflicts, { projectId })
    .then((rows) => {
      if (mySeq === s.seq) s.data = rows as ReservationConflict[];
    })
    .catch(() => {
      // Best-effort — a failed detection renders no banner rather than crashing.
      if (mySeq === s.seq) s.data = [];
    })
    .finally(() => {
      if (mySeq === s.seq) s.inFlight = false;
      s.subs.forEach((fn) => fn());
    });
}

/** Re-fetch and push to every subscriber (the writer's invalidate analogue). */
export function refreshProjectConflicts(projectId: string | undefined) {
  if (projectId) doFetch(projectId);
}

export function useProjectConflicts(projectId: string | undefined) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [, force] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) {
      // Session ended / switched — drop the module-global cache + client so the next
      // user can't see the previous session's conflict data before a fresh authorized
      // fetch (these stores outlive any component).
      stores.clear();
      clientHolder.current = null;
      return;
    }
    clientHolder.current = convex; // stamp the app's client for module-level refresh()
    if (!projectId) return;
    const s = storeFor(projectId);
    const cb = () => force((n) => n + 1);
    s.subs.add(cb);
    if (s.data === undefined && !s.inFlight) doFetch(projectId);
    return () => {
      s.subs.delete(cb);
    };
  }, [projectId, isAuthenticated, convex]);

  const s = projectId ? stores.get(projectId) : undefined;
  // Never serve cached data to an unauthenticated render (defense-in-depth alongside
  // the store clear above).
  return {
    data: isAuthenticated ? s?.data : undefined,
    isLoading: !!projectId && isAuthenticated && s?.data === undefined,
  };
}
