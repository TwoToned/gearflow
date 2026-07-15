"use client";

import { createSharedResource } from "./use-shared-resource";
import {
  getUncategorizedSubHireGroups,
  getUncategorizedProjectGroups,
} from "@/server/category-slots";
import { getSubHires, getSubHire } from "@/server/sub-hires";

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

// NOTE: project categories, uncategorized line items, and project overbooked status
// are now reactive native Convex subscriptions (useProjectCategoriesWithGroups in
// use-projects.ts + the equipment-tab's native read path) — the old server-action
// shared stores here were removed with the project-categories server action.

const uncatSubHireGroups = createSharedResource((projectId: string) => getUncategorizedSubHireGroups(projectId));
export const useUncategorizedSubHireGroups = uncatSubHireGroups.use;
export const refreshUncategorizedSubHireGroups = uncatSubHireGroups.refresh;

const uncatProjectGroups = createSharedResource((projectId: string) => getUncategorizedProjectGroups(projectId));
export const useUncategorizedProjectGroups = uncatProjectGroups.use;
export const refreshUncategorizedProjectGroups = uncatProjectGroups.refresh;

const subHires = createSharedResource((projectId: string) => getSubHires({ projectId }));
/** Subscribe to the project's sub-hires. Key = projectId. */
export const useProjectSubHires = subHires.use;
export const refreshProjectSubHires = subHires.refresh;

const subHire = createSharedResource((subHireId: string) => getSubHire(subHireId));
/** Subscribe to a single sub-hire's detail. Key = subHireId. */
export const useSubHire = subHire.use;
export const refreshSubHire = subHire.refresh;
