"use client";

import { createSharedResource } from "./use-shared-resource";
import { getProjectConflicts } from "@/server/reservation-conflicts";

/**
 * Shared store for a project's reservation conflicts (Phase 6 — React Query
 * removal). Read by the conflicts banner's parent and written (after a swap) by
 * the nested SwapPicker — cross-component within the banner, so a shared store
 * keyed by projectId lets the child call `refreshProjectConflicts(projectId)`
 * (its old `invalidateQueries(["project-conflicts"])`), removing the resolved
 * conflict from the parent's list. SSE is dead so no liveness lost.
 */
const resource = createSharedResource((projectId: string) => getProjectConflicts(projectId));

export const useProjectConflicts = resource.use;
export const refreshProjectConflicts = resource.refresh;
