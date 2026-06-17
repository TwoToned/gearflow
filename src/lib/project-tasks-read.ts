import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { ChecklistItem, ProjectTaskStatus, ProjectTaskPriority } from "@/lib/project-tasks";

/**
 * Server-side read helpers for project tasks (Phase A read-rewiring).
 *
 * `projectTask` is dual-written (Prisma FK anchor + Convex doc — see
 * src/lib/project-subtable-mirror.ts `syncProjectTasksToConvex`) and backfilled
 * (scripts/convex-backfill-project-subtables.ts). The read-only actions
 * (getProjectTasks, getMyOpenTasks, and the crew half of getTaskAssignees) read
 * the Convex copy through these helpers.
 *
 * CROSS-DOMAIN JOINS:
 * - assigneeCrew → CrewMember is a dual-written DOMAIN table, so it is attached
 *   from Convex (crew-read.ts).
 * - assigneeUser / createdBy → User is a Better Auth table (AUTH TERMINUS) that
 *   stays in Prisma forever; those halves are attached via a batched
 *   prisma.user.findMany in the server action.
 * - project (name/number for getMyOpenTasks) is a dual-written domain table,
 *   attached from Convex (projects-read.ts).
 *
 * NO Prisma fallback on a Convex map miss — a miss reads as the join against a
 * deleted row would (assignee/project null), which is the same behaviour Prisma's
 * `SetNull`/left-join relations produce. Falling back would hide mirror drift.
 *
 * Mappers convert epoch-ms → Date (serialize() keeps Date and Next serializes it
 * to an ISO string on the wire, matching the previous Prisma shape), absent →
 * null, and coerce Prisma-defaulted columns (status/priority/sortOrder) non-null.
 * See FEATUREDOCS/54.
 */

export type ConvexProjectTask = Doc<"projectTasks">;

/** The mapped shape mirrors `prisma.projectTask` rows (before include attach). */
export interface MappedProjectTask {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  dueDate: Date | null;
  sortOrder: number;
  checklist: ChecklistItem[] | null;
  assigneeUserId: string | null;
  assigneeCrewId: string | null;
  createdById: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const toDate = (ms: number | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms);

/**
 * Map a Convex projectTask doc to the Prisma-row shape. Strips _id/_creationTime,
 * coerces the Prisma-defaulted columns non-null, and turns epoch-ms back into Date.
 */
export function mapProjectTask(doc: ConvexProjectTask): MappedProjectTask {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    projectId: doc.projectId,
    title: doc.title,
    description: doc.description ?? null,
    status: (doc.status ?? "TODO") as ProjectTaskStatus,
    priority: (doc.priority ?? "NORMAL") as ProjectTaskPriority,
    dueDate: toDate(doc.dueDate),
    sortOrder: doc.sortOrder ?? 0,
    // checklist is stored as inline JSON (v.any()) — passed through unchanged.
    checklist: (doc.checklist ?? null) as ChecklistItem[] | null,
    assigneeUserId: doc.assigneeUserId ?? null,
    assigneeCrewId: doc.assigneeCrewId ?? null,
    createdById: doc.createdById ?? null,
    completedAt: toDate(doc.completedAt),
    // createdAt/updatedAt are @default(now())/@updatedAt — never absent for a real
    // row, but coerce defensively so the non-null Date contract holds.
    createdAt: toDate(doc.createdAt) ?? new Date(0),
    updatedAt: toDate(doc.updatedAt) ?? new Date(0),
  };
}

// ── Fetchers ────────────────────────────────────────────────────────────────

/** All projectTask rows for a project (Convex), mapped to Prisma-row shape. */
export async function getProjectTaskRowsByProject(
  projectId: string,
  orgId: string,
): Promise<MappedProjectTask[]> {
  const rows = await (await getConvexClient()).query(api.projectTasks.listByProject, {
    projectId,
    orgId,
  });
  return rows.map(mapProjectTask);
}

/** All projectTask rows for an org (Convex), mapped to Prisma-row shape. */
export async function getProjectTaskRowsByOrg(orgId: string): Promise<MappedProjectTask[]> {
  const rows = await (await getConvexClient()).query(api.projectTasks.list, { orgId });
  return rows.map(mapProjectTask);
}

// ── Pure filters / sorts (replicate Prisma where/orderBy) ─────────────────────

/**
 * getProjectTasks ordering: `[{ sortOrder: "asc" }, { createdAt: "asc" }]`.
 * Both columns are non-null, so no nulls handling needed.
 */
export function sortProjectTasks(tasks: MappedProjectTask[]): MappedProjectTask[] {
  return [...tasks].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/** Filter to a single project (Convex listByProject already filters projectId; the
 * org guard matches the Prisma `where: { organizationId, projectId }`). */
export function filterTasksForProject(
  tasks: MappedProjectTask[],
  projectId: string,
  orgId: string,
): MappedProjectTask[] {
  return tasks.filter((t) => t.projectId === projectId && t.organizationId === orgId);
}

// Postgres enum columns sort by DECLARED order, not alphabetical. ProjectTaskPriority
// is declared LOW, NORMAL, HIGH — so `priority: "desc"` orders HIGH > NORMAL > LOW.
const PRIORITY_RANK: Record<ProjectTaskPriority, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
};

/**
 * getMyOpenTasks where: `{ organizationId, assigneeUserId: userId, status != DONE,
 * project.isTemplate: false }`. The project-template predicate is applied here via
 * the supplied non-template projectId set (templates excluded by the caller).
 */
export function filterMyOpenTasks(
  tasks: MappedProjectTask[],
  orgId: string,
  userId: string,
  nonTemplateProjectIds: Set<string>,
): MappedProjectTask[] {
  return tasks.filter(
    (t) =>
      t.organizationId === orgId &&
      t.assigneeUserId === userId &&
      t.status !== "DONE" &&
      nonTemplateProjectIds.has(t.projectId),
  );
}

/**
 * getMyOpenTasks ordering:
 *   [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "asc" }]
 * Postgres ASC defaults NULLS LAST; this query makes it explicit. Dated tasks
 * surface first; ties break by priority HIGH→LOW then oldest createdAt first.
 */
export function sortMyOpenTasks(tasks: MappedProjectTask[]): MappedProjectTask[] {
  return [...tasks].sort((a, b) => {
    // dueDate asc, NULLS LAST.
    const ad = a.dueDate?.getTime() ?? null;
    const bd = b.dueDate?.getTime() ?? null;
    if (ad !== bd) {
      if (ad === null) return 1;
      if (bd === null) return -1;
      return ad - bd;
    }
    // priority desc (declared-order rank).
    const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (pr !== 0) return pr;
    // createdAt asc.
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

// ── Crew assignee picker (getTaskAssignees crew half) ─────────────────────────

export interface AssigneeCrew {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * The crew half of getTaskAssignees: org crew members excluding ARCHIVED, ordered
 * by firstName asc then lastName asc. Reads the dual-written Convex crewMember docs.
 */
export function selectCrewAssignees(crew: Doc<"crewMembers">[]): AssigneeCrew[] {
  return crew
    .filter((c) => c.status !== "ARCHIVED")
    .map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName }))
    .sort(
      (a, b) =>
        a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName),
    );
}
