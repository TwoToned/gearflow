"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import { formatDate } from "@/lib/formatters";
import {
  buildReadinessChecks,
  type ReadinessCheck,
  type ReadinessConflictInput,
} from "@/lib/project-readiness-checks";

/**
 * Double-booked assets for one job, ONE-SHOT (never a subscription): conflict
 * detection scans the org's whole booking graph (the R-8.3.3
 * `reservationConflicts-orgGraph` exception in docs/exceptions.md, renewed to
 * 2027-02-21), so a reactive read would re-run on every org write. It runs
 * once per job per mount. `null` until it answers, and on failure — the
 * readiness row then says "not checked", never "no conflicts".
 */
function useProjectConflictsOnce(projectId: string | undefined, enabled: boolean): ReadinessConflictInput[] | null {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [answer, setAnswer] = useState<{ projectId: string; rows: ReadinessConflictInput[] | null } | null>(null);

  useEffect(() => {
    if (!projectId || !enabled || !isAuthenticated) return;
    let current = true;
    convex
      .query(api.reservationConflicts.projectConflicts, { projectId })
      .then((rows) => current && setAnswer({ projectId, rows: rows as ReadinessConflictInput[] }))
      .catch(() => current && setAnswer({ projectId, rows: null }));
    return () => {
      current = false;
    };
  }, [convex, projectId, enabled, isAuthenticated]);

  return answer && answer.projectId === projectId ? answer.rows : null;
}

/**
 * The Overview's readiness rows, in one hook (#1061, restored in UX Phase 7
 * after `6bbdee8` deleted the original along with the Work card).
 *
 * Three sources, each the one home of its rule (R-3.1):
 *   - `projectReadiness.forProject` — gear, crew, services, unpriced, packing,
 *     and the bounded open-incidents count (reactive);
 *   - `reservationConflicts.projectConflicts` — double-booked assets (one-shot);
 *   - `collaboration.getProjectBlockingSummary` — blocking discussions (the
 *     same subscription the header ⋯ already holds, so no extra read).
 *
 * `checks` is `null` until `forProject` answers; the conflicts and blocking
 * reads may lag, and their rows say so rather than holding the rest back.
 */
export function useProjectReadiness(
  projectId: string,
  orgId: string | undefined,
  enabled: boolean,
  status?: string,
): { checks: ReadinessCheck[] | null } {
  const args = orgId && enabled ? { orgId, projectId } : "skip";
  const readiness = useAuthedQuery(api.projectReadiness.forProject, args);
  const blocking = useAuthedQuery(api.collaboration.getProjectBlockingSummary, args) as { count: number } | undefined;
  const conflicts = useProjectConflictsOnce(projectId, enabled && !!orgId);

  const checks = useMemo(() => {
    if (!readiness) return null;
    return buildReadinessChecks({
      hasWindow: readiness.hasWindow,
      windowLabel: readiness.window
        ? `${formatDate(new Date(readiness.window.start))} – ${formatDate(new Date(readiness.window.end))}`
        : undefined,
      gear: readiness.gear,
      crew: readiness.crew,
      pricing: readiness.pricing,
      packing: readiness.packing,
      incidents: readiness.incidents,
      conflicts,
      blockingCount: blocking?.count ?? null,
      status,
    });
  }, [readiness, conflicts, blocking, status]);

  return { checks };
}
