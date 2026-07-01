"use client";

import { getProject } from "@/server/projects";
import { useProject } from "./use-projects";
import { useNativeProjectDetail } from "./use-native-project-equipment";

/**
 * Project detail composite (Phase 4 — native-only; the version-vector +
 * getProject server-action path is retired).
 *
 * `["project", …, projectId]` is the SPINE of the project detail UI — header,
 * status, financial summary, managers. The whole composite now comes from live
 * Convex subscriptions (projectDetail.bundle + browserBundle) reconstructed
 * client-side, reactive over the WebSocket. Writes are still server actions whose
 * convex.mutation pushes the delta to the subscription, so the ~15 writers that
 * call `refreshProjectDetail` no longer need to — it is kept as a no-op below.
 *
 * `getProject` is retained only as a TYPE reference: the native reconstruction is a
 * thin DTO of the same shape, so casting to the server type preserves consumers'
 * typed field access.
 */
type ProjectDetail = Awaited<ReturnType<typeof getProject>>;

/** Subscribe to a project's detail composite. `projectId` is the store key. */
export function useProjectDetail(projectId: string) {
  // The Convex project doc is both the orgId source and the cross-tab change signal.
  const convexProject = useProject(projectId);
  const native = useNativeProjectDetail(projectId, convexProject?.organizationId);

  // While the project doc (the orgId source) is still loading, keep isLoading true
  // so the page shows its skeleton — NOT the "not found" state — during auth/orgId
  // resolution. `convexProject === null` (genuinely missing) is NOT loading.
  const orgResolving = convexProject === undefined;
  return {
    data: native.data as unknown as ProjectDetail | undefined,
    isLoading: orgResolving || native.isLoading,
    refresh: () => {},
  };
}

/**
 * Historic invalidate chokepoint for the writers that call it after a project
 * write. Now a no-op: the native projectDetail subscription pushes every change
 * live over the WebSocket, so an explicit refetch is redundant. Signature kept
 * unchanged to avoid touching every call site.
 */
export function refreshProjectDetail(_projectId?: string): void {
  /* native subscription is reactive — nothing to invalidate */
}
