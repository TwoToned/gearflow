"use client";

import { createSharedResource } from "./use-shared-resource";
import { getProject } from "@/server/projects";

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
 * ★ Data-identical note: many writers invalidated a 2-element `["project",
 * projectId]` key that did NOT prefix-match the 3-element reader key (a latent
 * no-op — same class as the sub-hire-order-dialog no-op in 2026-06-10l). Those
 * are now wired to `refreshProjectDetail(projectId)`, realising the clearly-
 * intended refresh (only ever an extra, beneficial getProject — never a regression).
 *
 * SSE is dead (the lowercase/PascalCase entityType bug), so no cross-user
 * liveness is lost vs the old `project:updated` invalidation; a version vector
 * (real cross-user liveness) is a deferred enhancement, not needed for parity.
 * project / project_line_item are dual-written; this read stays a server action
 * (getProject composes Better-Auth users + cross-domain joins).
 */
const resource = createSharedResource((projectId: string) => getProject(projectId));

/** Subscribe to a project's detail composite. `projectId` is the store key. */
export const useProjectDetail = resource.use;

/** Re-fetch the project and push to every subscriber (the writer's invalidate analogue). */
export const refreshProjectDetail = resource.refresh;
