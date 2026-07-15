"use client";

import { useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  useProjectCrewAssignments,
  fingerprintCrewAssignments,
} from "./use-crew-scheduling";

/**
 * Browser-direct shared stores for a project's crew + labour cost (Phase 3 — replaces
 * the getProjectCrew/getProjectLabourCost server actions). Read by the crew panel +
 * call-sheet dialog + page financial summary; refreshed by the crew panel + services
 * panel after a crew/service change. One-shot (NOT reactive — the crew composite scans
 * the org's members/roles/services; Appendix B). Cross-component refresh via the
 * module-level refreshProjectCrew/…LabourCost the writers call.
 *
 * The app's authenticated Convex client + the active orgId are component-local, so
 * they're stamped into a module holder from inside each reader's effect (a mutable
 * `.current` object, not a reassigned `let` — the React-Compiler no-reassign rule).
 */
type ConvexClient = ReturnType<typeof useConvex>;
const holder: { current: { convex: ConvexClient; orgId: string } | null } = { current: null };

interface Store<T> { data: T | undefined; subs: Set<() => void>; seq: number; }
// The crew composite is a wide, loosely-typed row (consumers use Record<string, any>).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const crewStores = new Map<string, Store<any[]>>();
const labourStores = new Map<string, Store<{ totalLabourCost: number; assignmentCount: number }>>();

function storeFor<T>(map: Map<string, Store<T>>, key: string): Store<T> {
  let s = map.get(key);
  if (!s) { s = { data: undefined, subs: new Set(), seq: 0 }; map.set(key, s); }
  return s;
}

// Stores keyed by `${orgId}:${projectId}` — an org switch must never render the
// previous org's cached crew/cost (codex).
const keyOf = (orgId: string, projectId: string) => `${orgId}:${projectId}`;

function fetchCrew(projectId: string): void {
  const h = holder.current;
  if (!h) return;
  const s = storeFor(crewStores, keyOf(h.orgId, projectId));
  const mySeq = ++s.seq;
  void h.convex.query(api.crewAssignments.projectCrew, { projectId, orgId: h.orgId })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .then((rows) => { if (mySeq === s.seq) s.data = rows as any[]; })
    .catch(() => { if (mySeq === s.seq) s.data = []; })
    .finally(() => { s.subs.forEach((fn) => fn()); });
}
function fetchLabour(projectId: string): void {
  const h = holder.current;
  if (!h) return;
  const s = storeFor(labourStores, keyOf(h.orgId, projectId));
  const mySeq = ++s.seq;
  void h.convex.query(api.crewAssignments.projectLabourCost, { projectId, orgId: h.orgId })
    .then((r) => { if (mySeq === s.seq) s.data = r; })
    .catch(() => { if (mySeq === s.seq) s.data = { totalLabourCost: 0, assignmentCount: 0 }; })
    .finally(() => { s.subs.forEach((fn) => fn()); });
}

export function refreshProjectCrew(projectId: string | undefined) { if (projectId) fetchCrew(projectId); }
export function refreshProjectLabourCost(projectId: string | undefined) { if (projectId) fetchLabour(projectId); }

function useSharedResource<T>(
  map: Map<string, Store<T>>,
  fetcher: (projectId: string) => void,
  projectId: string | undefined,
  orgId: string | undefined,
): { data: T | undefined; isLoading: boolean } {
  const convex = useConvex();
  const [, force] = useState(0);
  useEffect(() => {
    // Stamp the holder while authed; CLEAR it on logout/org-loss so a later
    // module-level refresh can't query the stale org (codex).
    if (orgId) holder.current = { convex, orgId };
    else holder.current = null;
  }, [convex, orgId]);
  useEffect(() => {
    if (!projectId || !orgId) return;
    const s = storeFor(map, keyOf(orgId, projectId));
    const cb = () => force((n) => n + 1);
    s.subs.add(cb);
    if (s.data === undefined) fetcher(projectId);
    return () => { s.subs.delete(cb); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, orgId]);
  const s = projectId && orgId ? map.get(keyOf(orgId, projectId)) : undefined;
  return { data: s?.data, isLoading: !!projectId && !!orgId && s?.data === undefined };
}

export function useProjectCrew(projectId: string | undefined, orgId: string | undefined) {
  return useSharedResource(crewStores, fetchCrew, projectId, orgId);
}
export function useProjectLabourCost(projectId: string | undefined, orgId: string | undefined) {
  return useSharedResource(labourStores, fetchLabour, projectId, orgId);
}

/**
 * Cross-tab live sync: subscribe to the dual-written Convex crewAssignments table (by
 * project); when another tab changes crew, re-fetch the crew + labour-cost composites.
 * Mount once in the crew panel.
 */
export function useProjectCrewLiveSync(projectId: string | undefined, orgId: string | undefined) {
  const assignments = useProjectCrewAssignments(projectId, orgId);
  const fp = fingerprintCrewAssignments(assignments);
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!projectId) return;
    if (fp !== undefined && prev.current !== undefined && fp !== prev.current) {
      fetchCrew(projectId);
      fetchLabour(projectId);
    }
    if (fp !== undefined) prev.current = fp;
  }, [projectId, fp]);
}
