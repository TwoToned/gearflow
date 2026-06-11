"use client";

import { createSharedResource } from "./use-shared-resource";
import { getProjectCrew, getProjectLabourCost } from "@/server/crew-assignments";

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
