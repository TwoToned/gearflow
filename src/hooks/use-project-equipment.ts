"use client";

import { createSharedResource } from "./use-shared-resource";
import {
  getProjectCategories,
  getUncategorizedLineItems,
  getProjectOverbookedStatus,
} from "@/server/project-categories";
import {
  getUncategorizedSubHireGroups,
  getUncategorizedProjectGroups,
} from "@/server/category-slots";
import { getSubHires } from "@/server/sub-hires";

/**
 * Shared stores for the project equipment-tab composition (Phase 6 — React Query
 * removal). The equipment editor reads these as one interlocked composition and
 * refreshes them together through a single `invalidate()` chokepoint (passed to
 * child dialogs via `onInvalidate`). Several are ALSO read by the equipment add
 * form / sub-hire order dialog (category dropdowns), so a shared store keyed by
 * **projectId** keeps every reader in sync when any writer mutates — reproducing
 * React Query's shared `["project-categories", projectId]` (etc.) cache refresh
 * without prop-drilling. All are dual-written infra; the reads stay server actions
 * (cross-domain composition). SSE is dead so no cross-user liveness is lost.
 */

const categories = createSharedResource((projectId: string) => getProjectCategories(projectId));
/** Subscribe to the project's category/group composition. Key = projectId. */
export const useProjectCategories = categories.use;
export const refreshProjectCategories = categories.refresh;

const uncatItems = createSharedResource((projectId: string) => getUncategorizedLineItems(projectId));
export const useUncategorizedItems = uncatItems.use;
export const refreshUncategorizedItems = uncatItems.refresh;

const uncatSubHireGroups = createSharedResource((projectId: string) => getUncategorizedSubHireGroups(projectId));
export const useUncategorizedSubHireGroups = uncatSubHireGroups.use;
export const refreshUncategorizedSubHireGroups = uncatSubHireGroups.refresh;

const uncatProjectGroups = createSharedResource((projectId: string) => getUncategorizedProjectGroups(projectId));
export const useUncategorizedProjectGroups = uncatProjectGroups.use;
export const refreshUncategorizedProjectGroups = uncatProjectGroups.refresh;

const overbooked = createSharedResource((projectId: string) => getProjectOverbookedStatus(projectId));
export const useProjectOverbooked = overbooked.use;
export const refreshProjectOverbooked = overbooked.refresh;

const subHires = createSharedResource((projectId: string) => getSubHires({ projectId }));
/** Subscribe to the project's sub-hires. Key = projectId. */
export const useProjectSubHires = subHires.use;
export const refreshProjectSubHires = subHires.refresh;
