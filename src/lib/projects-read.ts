import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

export type ConvexProject = Doc<"projects">;
export type ConvexProjectService = Doc<"projectServices">;
export type ConvexCrewAssignment = Doc<"crewAssignments">;

export async function getProjectsByOrg(orgId: string): Promise<ConvexProject[]> {
  return await (await getConvexClient()).query(api.projects.list, { orgId });
}

export async function getProjectById(id: string): Promise<ConvexProject | null> {
  return await (await getConvexClient()).query(api.projects.getById, { id });
}

/** Returns the set of projectIds where userId appears as a project manager. */
export async function getProjectIdsForManager(orgId: string, userId: string): Promise<Set<string>> {
  const client = await getConvexClient();
  const entries = await client.query(api.projectManagers.list, { orgId });
  return new Set(entries.filter((e) => e.userId === userId).map((e) => e.projectId));
}

/** Convert an optional epoch-ms field to a Date (serialize keeps Date), else null. */
function epochToDate(ms: number | undefined | null): Date | null {
  return ms == null ? null : new Date(ms);
}

/**
 * Project milestone dates used by the call-sheet date picker. Replaces the
 * scalar-only `prisma.project.findUnique(... select dates ...)` read — the
 * `project` row is dual-written to Convex, so these come from the Convex doc.
 * Epoch-ms is converted back to `Date` because `serialize()` round-trips Dates.
 */
export type CallSheetMilestoneDates = {
  loadInDate: Date | null;
  eventStartDate: Date | null;
  eventEndDate: Date | null;
  loadOutDate: Date | null;
};

export function mapCallSheetMilestoneDates(project: ConvexProject): CallSheetMilestoneDates {
  return {
    loadInDate: epochToDate(project.loadInDate),
    eventStartDate: epochToDate(project.eventStartDate),
    eventEndDate: epochToDate(project.eventEndDate),
    loadOutDate: epochToDate(project.loadOutDate),
  };
}

export type CallSheetServiceDate = { date: Date; crewCount: number };

/**
 * Pure replacement for the Prisma `projectService.findMany({ where: status !=
 * CANCELLED, select: { date, _count: { crewAssignments } }, orderBy: date asc })`
 * read, plus its dropped-null filter at the call site. Replicates exactly:
 *   - drop services whose `status === "CANCELLED"` (Prisma `where`)
 *   - drop services with no `date` (the call site's `.filter(s => s.date != null)`)
 *   - `crewCount` = number of crew assignments whose `serviceId` matches the
 *     service (Prisma `_count: { crewAssignments }`, the per-service relation count)
 *   - order ascending by `date` (Prisma `orderBy: { date: "asc" }`)
 * Epoch-ms `date` is converted back to a `Date`.
 */
export function buildCallSheetServiceDates(
  services: ConvexProjectService[],
  assignments: ConvexCrewAssignment[],
): CallSheetServiceDate[] {
  const countByServiceId = new Map<string, number>();
  for (const a of assignments) {
    if (a.serviceId == null) continue;
    countByServiceId.set(a.serviceId, (countByServiceId.get(a.serviceId) ?? 0) + 1);
  }
  return services
    .filter((s) => s.status !== "CANCELLED" && s.date != null)
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
    .map((s) => ({
      date: new Date(s.date as number),
      crewCount: countByServiceId.get(s.id) ?? 0,
    }));
}

/**
 * Convex fetchers for the call-sheet date picker: the project milestone dates +
 * its (non-cancelled, dated) services with per-service crew counts. Mirrors the
 * old `getCallSheetDates` Prisma reads. Returns `null` when the project is
 * missing (no Prisma fallback — a miss means the row isn't mirrored / was
 * deleted, exactly like a join against a deleted row).
 */
export async function getCallSheetData(
  orgId: string,
  projectId: string,
): Promise<{ milestones: CallSheetMilestoneDates; serviceDates: CallSheetServiceDate[] } | null> {
  const client = await getConvexClient();
  const [project, services, assignments] = await Promise.all([
    client.query(api.projects.getById, { id: projectId }),
    client.query(api.projectServices.listByProject, { projectId, orgId }),
    client.query(api.crewAssignments.listByProject, { projectId, orgId }),
  ]);
  if (!project || project.organizationId !== orgId) return null;
  return {
    milestones: mapCallSheetMilestoneDates(project),
    serviceDates: buildCallSheetServiceDates(services, assignments),
  };
}
