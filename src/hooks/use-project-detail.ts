"use client";

import { useEffect, useRef } from "react";
import { createSharedResource } from "./use-shared-resource";
import { getProject } from "@/server/projects";
import { useProject } from "./use-projects";
import {
  NATIVE_PROJECT_DETAIL_ENABLED,
  useNativeProjectDetail,
} from "./use-native-project-equipment";

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
  // When the native flag is on, DON'T fire the old getProject server action — pass
  // `undefined` so the shared resource skips its fetch (no double-fetch alongside
  // the native subscriptions). The version-vector refresh effect is also a no-op
  // then (native is reactive over the WebSocket).
  const result = resource.use(NATIVE_PROJECT_DETAIL_ENABLED ? undefined : projectId);

  // Convex subscription for cross-tab change detection (also the orgId source).
  const convexProject = useProject(projectId);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (NATIVE_PROJECT_DETAIL_ENABLED) return; // native path needs no manual refresh
    const next = convexProject?.updatedAt;
    if (next !== undefined && prevUpdatedAt.current !== undefined && next !== prevUpdatedAt.current) {
      resource.refresh(projectId);
    }
    if (next !== undefined) {
      prevUpdatedAt.current = next;
    }
  }, [convexProject?.updatedAt, projectId]);

  // Native read-layer path (Phase 1d, default OFF). When the flag is on, the whole
  // composite comes from live Convex subscriptions (projectDetail.bundle +
  // browserBundle) reconstructed client-side — no server action, reactive by the
  // WebSocket. orgId is read off the project doc this hook already subscribes to.
  // Both paths' hooks run (rules-of-hooks); the flag only selects which result we
  // return. When the flag is off, `useNativeProjectDetail` is a no-op (skips).
  const native = useNativeProjectDetail(projectId, convexProject?.organizationId);
  if (NATIVE_PROJECT_DETAIL_ENABLED) {
    return {
      data: native.data as typeof result.data,
      isLoading: native.isLoading,
      refresh: () => resource.refresh(projectId),
    };
  }

  return result;
}

/** Re-fetch the project and push to every subscriber (the writer's invalidate analogue). */
export const refreshProjectDetail = resource.refresh;
