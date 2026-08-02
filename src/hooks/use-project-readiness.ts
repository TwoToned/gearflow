"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useProjectConflicts } from "@/hooks/use-project-conflicts";
import { api } from "../../convex/_generated/api";
import { formatDate } from "@/lib/formatters";
import {
  buildReadinessChecks,
  summariseReadiness,
  type ReadinessCheck,
  type ReadinessSummary,
} from "@/lib/project-readiness-checks";

/**
 * The Overview tab's Readiness panel, in one hook (#1061).
 *
 * Fans two sources into the single ordered check list
 * `project-readiness-checks.ts` derives. They stay separate on purpose — each
 * rule has exactly one home (R-3.1), and both predate this panel:
 *
 *   - `projectReadiness.forProject`            — gear, crew, unpriced (reactive,
 *     same bounded read shape the org board already subscribes to)
 *   - `reservationConflicts.projectConflicts`  — double-booked assets. ONE-SHOT
 *     by design: conflict detection scans the org's whole booking graph, so a
 *     reactive subscription would re-run on every org write (see the R-8.3.3
 *     entry in docs/exceptions.md). It refreshes when a swap resolves one.
 *
 * Stale auto-pricing is deliberately NOT fanned in here — it's the Finance
 * tab's `StalePricingBanner` (`useProjectPricingStaleness`), and surfacing it
 * a second time on Overview just repeated the same fact.
 *
 * `isLoading` is true only until the readiness query itself resolves. The
 * conflicts one-shot is allowed to lag: a checklist that withholds three
 * known answers waiting on the fourth is worse than one that fills in.
 */
export function useProjectReadiness(
  projectId: string | undefined,
  orgId: string | undefined,
): {
  checks: ReadinessCheck[];
  summary: ReadinessSummary;
  isLoading: boolean;
} {
  const readiness = useAuthedQuery(
    api.projectReadiness.forProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
  const { data: conflicts } = useProjectConflicts(projectId);

  return useMemo(() => {
    if (!readiness) {
      return { checks: [], summary: summariseReadiness([]), isLoading: true };
    }
    const checks = buildReadinessChecks({
      hasWindow: readiness.hasWindow,
      windowLabel: readiness.window
        ? `${formatDate(new Date(readiness.window.start))} – ${formatDate(new Date(readiness.window.end))}`
        : undefined,
      gear: readiness.gear,
      crew: readiness.crew,
      pricing: readiness.pricing,
      conflicts: conflicts ?? [],
    });
    return { checks, summary: summariseReadiness(checks), isLoading: false };
  }, [readiness, conflicts]);
}
