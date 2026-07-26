import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for ProjectManager (Phase A read-rewiring).
 *
 * `projectManager` is dual-written (Prisma FK anchor + Convex reactive doc — see
 * src/lib/project-subtable-mirror.ts `syncProjectManagersToConvex`, backfilled by
 * scripts/convex-backfill-project-subtables.ts). Pure reads of projectManager rows
 * go through these helpers. The `user` half is Better Auth and stays a batched
 * Prisma lookup in the server action. No Prisma fallback on a Convex miss. See
 * FEATUREDOCS/54.
 */
export type ConvexProjectManager = Doc<"projectManagers">;

/** A projectManager row mapped back to the Prisma `ProjectManager` shape (epoch-ms → Date). */
export interface ProjectManagerRow {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  addedAt: Date;
}

function mapProjectManager(doc: ConvexProjectManager): ProjectManagerRow {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    projectId: doc.projectId,
    userId: doc.userId,
    // addedAt has a Prisma @default(now()); a backfilled/older row may be absent.
    addedAt: doc.addedAt != null ? new Date(doc.addedAt) : new Date(0),
  };
}

/**
 * Pure: replicate Prisma `where: { projectId, organizationId }` + `orderBy: { addedAt: "asc" }`.
 * The Convex `list` query returns ALL of an org's managers; we filter + sort in JS.
 */
export function filterAndSortManagers(
  docs: ConvexProjectManager[],
  projectId: string,
  organizationId: string,
): ProjectManagerRow[] {
  return docs
    .filter((d) => d.projectId === projectId && d.organizationId === organizationId)
    .map(mapProjectManager)
    .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
}

/** Fetch + filter + sort an org's project managers for one project (Convex-backed). */
export async function getProjectManagerRows(
  organizationId: string,
  projectId: string,
): Promise<ProjectManagerRow[]> {
  const docs = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.projectManagers.listByProject, { projectId, orgId: organizationId }),
  );
  return filterAndSortManagers(docs, projectId, organizationId);
}
