"use client";

import { useEffect, useRef } from "react";
import { createSharedResource } from "./use-shared-resource";
import { getProject } from "@/server/projects";
import { useProject } from "./use-projects";

/**
 * Shared store for a project's detail composite (Phase 6 — React Query removal).
 * Replaces the `useQuery({ queryKey: ["project", orgId, id], queryFn: () =>
 * getProject(id) })` readers on the project detail / edit / runsheet pages.
 *
 * `["project", …, projectId]` is the SPINE of the project detail UI — header,
 * status, financial summary, managers — and is invalidated by ~10 scattered
 * writers (status/archive on the page, the services panel, the sub-hire order
 * dialog, the equipment add forms, the managers panel). A shared store keyed by
 * **projectId** lets any of those writers call `refreshProjectDetail(projectId)`
 * without prop-drilling a refetch callback through the 1000–1600-line equipment /
 * services components — reproducing React Query's shared `["project", …]` cache
 * refresh.
 *
 * Cross-tab reactivity: also subscribes to the Convex `projects` table via
 * `useProject`. When another browser tab (or collaborator) mutates the project,
 * the Convex mirror fires a websocket push to ALL subscribed tabs; the updatedAt
 * change detected here triggers refreshProjectDetail, re-fetching the full Prisma
 * composite so the UI syncs without a manual refresh.
 */
const resource = createSharedResource((projectId: string) => getProject(projectId));

/** Subscribe to a project's detail composite. `projectId` is the store key. */
export function useProjectDetail(projectId: string) {
  const result = resource.use(projectId);

  // Convex subscription for cross-tab change detection.
  const convexProject = useProject(projectId);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    const next = convexProject?.updatedAt;
    if (next !== undefined && prevUpdatedAt.current !== undefined && next !== prevUpdatedAt.current) {
      resource.refresh(projectId);
    }
    if (next !== undefined) {
      prevUpdatedAt.current = next;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convexProject?.updatedAt, projectId]);

  return result;
}

/** Re-fetch the project and push to every subscriber (the writer's invalidate analogue). */
export const refreshProjectDetail = resource.refresh;
