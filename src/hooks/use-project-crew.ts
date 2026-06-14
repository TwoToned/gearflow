"use client";

import { useEffect, useRef } from "react";
import { createSharedResource } from "./use-shared-resource";
import { getProjectCrew, getProjectLabourCost } from "@/server/crew-assignments";
import {
  useProjectCrewAssignments,
  fingerprintCrewAssignments,
} from "./use-crew-scheduling";

/**
 * Shared stores for a project's crew (Phase 6 — React Query removal).
 * project-crew is read by the crew panel + call-sheet dialog and written by the
 * crew panel + (on service crew changes) the services panel; project-labour-cost
 * is read by the crew panel + the page financial summary and written by the crew
 * panel. Shared stores keyed by projectId keep them in sync — assigning/removing
 * crew or changing a service's crew refreshes every reader. Writers call
 * `refreshProjectCrew(projectId)` / `refreshProjectLabourCost(projectId)`.
 * Dual-written infra; reads stay server actions. SSE is dead so no liveness lost.
 */

const crew = createSharedResource((projectId: string) => getProjectCrew(projectId));
export const useProjectCrew = crew.use;
export const refreshProjectCrew = crew.refresh;

const labour = createSharedResource((projectId: string) => getProjectLabourCost(projectId));
export const useProjectLabourCost = labour.use;
export const refreshProjectLabourCost = labour.refresh;

/**
 * Cross-tab live sync for a project's crew. Subscribes to the dual-written
 * Convex crewAssignments table (by project); when another tab assigns/removes
 * crew, confirms an offer, or changes a booking, the mirror pushes the change
 * and we re-fetch the crew + labour-cost composites. Mount once in the crew panel.
 */
export function useProjectCrewLiveSync(
  projectId: string | undefined,
  orgId: string | undefined,
) {
  const assignments = useProjectCrewAssignments(projectId, orgId);
  const fp = fingerprintCrewAssignments(assignments);
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!projectId) return;
    if (fp !== undefined && prev.current !== undefined && fp !== prev.current) {
      crew.refresh(projectId);
      labour.refresh(projectId);
    }
    if (fp !== undefined) prev.current = fp;
  }, [projectId, fp]);
}
