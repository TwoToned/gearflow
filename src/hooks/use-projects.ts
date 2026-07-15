"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
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
export type ProjectLineItemDoc = Doc<"projectLineItems">;
export type SubHireDoc = Doc<"subHires">;

/** All projects for an org (includes templates — filter isTemplate in consumer). */
export function useProjects(orgId: string | undefined): ProjectDoc[] | undefined {
  return useAuthedQuery(api.projects.list, orgId ? { orgId } : "skip");
}

/** Single project by cuid. Returns undefined while loading, null if not found. */
export function useProject(id: string | undefined): ProjectDoc | null | undefined {
  return useAuthedQuery(api.projects.getById, id ? { id } : "skip");
}

/** All categories for a project. */
export function useProjectCategories(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectCategoryDoc[] | undefined {
  return useAuthedQuery(
    api.projectCategories.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All groups for a project. */
export function useProjectGroups(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectGroupDoc[] | undefined {
  return useAuthedQuery(
    api.projectGroups.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** A category with its (native, reactive) child project groups nested under it. */
export interface ProjectCategoryWithGroups extends ProjectCategoryDoc {
  groups: ProjectGroupDoc[];
}

/**
 * Categories + their project groups composed into the `{ ...category, groups }`
 * shape the placement pickers consume (equipment add-form / sub-hire order dialog).
 * Both category and group tables are reactive native subscriptions, so this replaces
 * the old getProjectCategories server-action store with a live, prop-drill-free read.
 * Categories are sorted by sortOrder; each category's groups by sortOrder.
 */
export function useProjectCategoriesWithGroups(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectCategoryWithGroups[] | undefined {
  const cats = useProjectCategories(projectId, orgId);
  const groups = useProjectGroups(projectId, orgId);
  return useMemo(() => {
    if (!cats) return undefined;
    const byCat = new Map<string, ProjectGroupDoc[]>();
    for (const g of groups ?? []) {
      if (!g.categoryId) continue;
      const arr = byCat.get(g.categoryId) ?? [];
      arr.push(g);
      byCat.set(g.categoryId, arr);
    }
    return [...cats]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((c) => ({
        ...c,
        groups: (byCat.get(c.id) ?? []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
      }));
  }, [cats, groups]);
}

/** All manager entries for a project (userId only — join user details separately). */
export function useProjectManagers(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectManagerDoc[] | undefined {
  return useAuthedQuery(
    api.projectManagers.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All services for a project. */
export function useProjectServices(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectServiceDoc[] | undefined {
  return useAuthedQuery(
    api.projectServices.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All tasks for a project. */
export function useProjectTasks(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectTaskDoc[] | undefined {
  return useAuthedQuery(
    api.projectTasks.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All line items for a project (flat — parent + child rows; pricing spine). */
export function useProjectLineItems(
  projectId: string | undefined,
  orgId: string | undefined,
): ProjectLineItemDoc[] | undefined {
  return useAuthedQuery(
    api.projectLineItems.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}

/** All sub-hires for a project (3rd-party rental orders). */
export function useProjectSubHireDocs(
  projectId: string | undefined,
  orgId: string | undefined,
): SubHireDoc[] | undefined {
  return useAuthedQuery(
    api.subHires.listByProject,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
}
