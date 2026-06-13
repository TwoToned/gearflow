"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive project hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * project tables over a WebSocket, so any project create/update/delete (via the
 * dual-write server actions) pushes a live update to every subscriber, including
 * other browser tabs. No staleTime, no manual invalidation.
 *
 * Pass `undefined` to skip (e.g. before org context loads).
 *
 * NOTE: `useProjects` returns ALL projects for the org (including templates). Filter
 * `isTemplate: false` in the consumer when showing the active project list.
 */

export type ProjectDoc = Doc<"projects">;
export type ProjectCategoryDoc = Doc<"projectCategories">;
export type ProjectGroupDoc = Doc<"projectGroups">;
export type ProjectManagerDoc = Doc<"projectManagers">;
export type ProjectServiceDoc = Doc<"projectServices">;
export type ProjectTaskDoc = Doc<"projectTasks">;

/** All projects for an org (includes templates — filter isTemplate in consumer). */
export function useProjects(orgId: string | undefined): ProjectDoc[] | undefined {
  return useQuery(api.projects.list, orgId ? { orgId } : "skip");
}

/** Single project by cuid. Returns undefined while loading, null if not found. */
export function useProject(id: string | undefined): ProjectDoc | null | undefined {
  return useQuery(api.projects.getById, id ? { id } : "skip");
}

/** All categories for a project. */
export function useProjectCategories(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectCategoryDoc[] | undefined {
  return useQuery(
    api.projectCategories.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All groups for a project. */
export function useProjectGroups(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectGroupDoc[] | undefined {
  return useQuery(
    api.projectGroups.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All manager entries for a project (userId only — join user details separately). */
export function useProjectManagers(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectManagerDoc[] | undefined {
  return useQuery(
    api.projectManagers.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All services for a project. */
export function useProjectServices(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectServiceDoc[] | undefined {
  return useQuery(
    api.projectServices.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All tasks for a project. */
export function useProjectTasks(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectTaskDoc[] | undefined {
  return useQuery(
    api.projectTasks.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}
