"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { getCrewMembersByOrg } from "@/lib/crew-read";
import {
  getProjectTaskRowsByProject,
  getProjectTaskRowsByOrg,
  filterTasksForProject,
  sortProjectTasks,
  filterMyOpenTasks,
  sortMyOpenTasks,
  selectCrewAssignees,
  type MappedProjectTask,
} from "@/lib/project-tasks-read";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { ProjectTaskStatus, ProjectTaskPriority, ChecklistItem } from "@/lib/project-tasks";

/**
 * Attach the include relations onto Convex-sourced projectTask rows, replicating
 * `taskInclude`:
 *   - assigneeUser ({ id, name, image }) + createdBy ({ id, name }) → Better Auth
 *     User (AUTH TERMINUS, stays Prisma) via one batched findMany.
 *   - assigneeCrew ({ id, firstName, lastName }) → CrewMember (dual-written domain)
 *     attached from the Convex crew docs.
 * No fallback on a map miss: a missing assignee/creator reads null, exactly as a
 * Prisma `SetNull` relation would after the referenced row is deleted.
 */
async function attachTaskRelations<T extends MappedProjectTask>(
  organizationId: string,
  tasks: T[],
) {
  const userIds = new Set<string>();
  const crewIds = new Set<string>();
  for (const t of tasks) {
    if (t.assigneeUserId) userIds.add(t.assigneeUserId);
    if (t.createdById) userIds.add(t.createdById);
    if (t.assigneeCrewId) crewIds.add(t.assigneeCrewId);
  }

  const [users, crew] = await Promise.all([
    userIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, image: true },
        })
      : Promise.resolve([] as { id: string; name: string; image: string | null }[]),
    crewIds.size ? getCrewMembersByOrg(organizationId) : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const crewMap = new Map(crew.map((c) => [c.id, c]));

  return tasks.map((t) => {
    const u = t.assigneeUserId ? userMap.get(t.assigneeUserId) : undefined;
    const creator = t.createdById ? userMap.get(t.createdById) : undefined;
    const c = t.assigneeCrewId ? crewMap.get(t.assigneeCrewId) : undefined;
    return {
      ...t,
      assigneeUser: u ? { id: u.id, name: u.name, image: u.image } : null,
      assigneeCrew: c ? { id: c.id, firstName: c.firstName, lastName: c.lastName } : null,
      createdBy: creator ? { id: creator.id, name: creator.name } : null,
    };
  });
}

/** Validate that an assignee (user member or crew) belongs to the org. Throws otherwise. */
async function assertAssigneeInOrg(
  organizationId: string,
  assigneeUserId?: string | null,
  assigneeCrewId?: string | null,
) {
  if (assigneeUserId && assigneeCrewId) {
    throw new Error("A task can be assigned to either a user or a crew member, not both");
  }
  if (assigneeUserId) {
    const member = await prisma.member.findFirst({
      where: { organizationId, userId: assigneeUserId },
      select: { id: true },
    });
    if (!member) throw new Error("Assigned user is not a member of this organization");
  }
  if (assigneeCrewId) {
    const convex = await getConvexClient();
    const crew = await convex.query(api.crewMembers.getById, { id: assigneeCrewId });
    if (!crew || crew.organizationId !== organizationId) throw new Error("Assigned crew member not found");
  }
}

function normaliseChecklist(checklist?: ChecklistItem[] | null): unknown {
  if (checklist === undefined) return undefined;
  if (checklist === null) return [];
  return checklist.map((c) => ({ id: c.id, text: c.text, done: !!c.done }));
}

/**
 * People a task can be assigned to: org members (users) + crew members.
 */
export async function getTaskAssignees() {
  const { organizationId } = await requirePermission("project", "read");

  const [members, crewDocs] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId },
      select: { user: { select: { id: true, name: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
    getCrewMembersByOrg(organizationId),
  ]);

  return serialize({
    users: members.map((m) => m.user).filter(Boolean),
    crew: selectCrewAssignees(crewDocs),
  });
}

export async function getProjectTasks(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");

  const rows = await getProjectTaskRowsByProject(projectId, organizationId);
  const sorted = sortProjectTasks(filterTasksForProject(rows, projectId, organizationId));
  const tasks = await attachTaskRelations(organizationId, sorted);

  return serialize(tasks);
}

export async function createProjectTask(data: {
  projectId: string;
  title: string;
  description?: string | null;
  status?: ProjectTaskStatus;
  priority?: ProjectTaskPriority;
  dueDate?: string | null;
  assigneeUserId?: string | null;
  assigneeCrewId?: string | null;
  checklist?: ChecklistItem[] | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");

  const title = data.title.trim();
  if (!title) throw new Error("Task title is required");

  const project = await getProjectById(data.projectId);
  if (!project || project.organizationId !== organizationId) throw new Error("Project not found");

  await assertAssigneeInOrg(organizationId, data.assigneeUserId, data.assigneeCrewId);

  const convex = await getConvexClient();
  const existingTasks = await convex.query(api.projectTasks.listByProject, {
    projectId: data.projectId,
    orgId: organizationId,
  });
  const sortOrder = existingTasks.reduce((max, t) => Math.max(max, t.sortOrder ?? 0), 0) + 1;

  const status = data.status ?? "TODO";
  const now = Date.now();
  const id = createId();
  const completedAt = status === "DONE" ? now : undefined;

  await convex.mutation(api.projectTasks.createIfMissing, {
    id,
    organizationId,
    projectId: data.projectId,
    title,
    description: data.description?.trim() || undefined,
    status,
    priority: data.priority ?? "NORMAL",
    dueDate: data.dueDate ? new Date(data.dueDate).getTime() : undefined,
    assigneeUserId: data.assigneeUserId || undefined,
    assigneeCrewId: data.assigneeCrewId || undefined,
    checklist: normaliseChecklist(data.checklist) ?? undefined,
    createdById: userId,
    completedAt,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  });

  const taskRow: MappedProjectTask = {
    id,
    organizationId,
    projectId: data.projectId,
    title,
    description: data.description?.trim() || null,
    status,
    priority: data.priority ?? "NORMAL",
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    assigneeUserId: data.assigneeUserId || null,
    assigneeCrewId: data.assigneeCrewId || null,
    checklist: (normaliseChecklist(data.checklist) as ChecklistItem[] | null) ?? null,
    createdById: userId,
    completedAt: completedAt ? new Date(completedAt) : null,
    sortOrder,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  const [enriched] = await attachTaskRelations(organizationId, [taskRow]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "ProjectTask",
    entityId: id,
    entityName: title,
    summary: `Added task "${title}"`,
    projectId: data.projectId,
  });

  return serialize(enriched);
}

export async function updateProjectTask(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    status?: ProjectTaskStatus;
    priority?: ProjectTaskPriority;
    dueDate?: string | null;
    assigneeUserId?: string | null;
    assigneeCrewId?: string | null;
    checklist?: ChecklistItem[] | null;
  },
) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");

  const convex = await getConvexClient();
  const existing = await convex.query(api.projectTasks.getById, { id });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Task not found");

  if (data.title !== undefined && !data.title.trim()) throw new Error("Task title is required");
  await assertAssigneeInOrg(organizationId, data.assigneeUserId, data.assigneeCrewId);

  let completedAt: number | null | undefined;
  if (data.status !== undefined && data.status !== existing.status) {
    completedAt = data.status === "DONE" ? Date.now() : null;
  }

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (data.title !== undefined) patch.title = data.title.trim();
  if (data.description !== undefined) patch.description = data.description?.trim() || null;
  if (data.status !== undefined) patch.status = data.status;
  if (data.priority !== undefined) patch.priority = data.priority;
  if (data.dueDate !== undefined) patch.dueDate = data.dueDate ? new Date(data.dueDate).getTime() : null;
  if (data.assigneeUserId !== undefined) patch.assigneeUserId = data.assigneeUserId || null;
  if (data.assigneeCrewId !== undefined) patch.assigneeCrewId = data.assigneeCrewId || null;
  if (data.checklist !== undefined) patch.checklist = normaliseChecklist(data.checklist);
  if (completedAt !== undefined) patch.completedAt = completedAt;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await convex.mutation(api.projectTasks.update, { id, patch: patch as any });

  const merged = { ...existing, ...patch };
  const taskRow: MappedProjectTask = {
    id,
    organizationId,
    projectId: existing.projectId,
    title: (patch.title as string | undefined) ?? existing.title,
    description: (patch.description as string | null | undefined) ?? existing.description ?? null,
    status: (patch.status as ProjectTaskStatus | undefined) ?? existing.status ?? "TODO",
    priority: (patch.priority as ProjectTaskPriority | undefined) ?? existing.priority ?? "NORMAL",
    dueDate: (patch.dueDate as number | null | undefined) != null
      ? new Date(patch.dueDate as number)
      : merged.dueDate ? new Date(merged.dueDate) : null,
    assigneeUserId: (patch.assigneeUserId as string | null | undefined) ?? existing.assigneeUserId ?? null,
    assigneeCrewId: (patch.assigneeCrewId as string | null | undefined) ?? existing.assigneeCrewId ?? null,
    checklist: (patch.checklist as ChecklistItem[] | null | undefined) ?? (existing.checklist as ChecklistItem[] | null) ?? null,
    createdById: existing.createdById ?? null,
    completedAt: completedAt != null ? new Date(completedAt) : completedAt === null ? null : (existing.completedAt ? new Date(existing.completedAt) : null),
    sortOrder: existing.sortOrder ?? 0,
    createdAt: existing.createdAt ? new Date(existing.createdAt) : new Date(0),
    updatedAt: new Date(patch.updatedAt as number),
  };
  const [enriched] = await attachTaskRelations(organizationId, [taskRow]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "ProjectTask",
    entityId: id,
    entityName: taskRow.title,
    summary: `Updated task "${taskRow.title}"`,
    projectId: existing.projectId,
  });

  return serialize(enriched);
}

export async function deleteProjectTask(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");

  const convex = await getConvexClient();
  const existing = await convex.query(api.projectTasks.getById, { id });
  if (!existing || existing.organizationId !== organizationId) throw new Error("Task not found");

  await convex.mutation(api.projectTasks.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "ProjectTask",
    entityId: existing.id,
    entityName: existing.title,
    summary: `Deleted task "${existing.title}"`,
    projectId: existing.projectId,
  });
}

/**
 * Persist a new ordering for a project's tasks.
 */
export async function reorderProjectTasks(projectId: string, orderedIds: string[]) {
  const { organizationId } = await requirePermission("project", "update");

  const convex = await getConvexClient();
  const now = Date.now();
  for (let index = 0; index < orderedIds.length; index++) {
    await convex.mutation(api.projectTasks.update, {
      id: orderedIds[index],
      patch: { sortOrder: index, updatedAt: now },
    });
  }
}

export async function getMyOpenTasks(limit = 25) {
  const { organizationId, userId } = await requirePermission("project", "read");

  const [rows, projects] = await Promise.all([
    getProjectTaskRowsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);

  const nonTemplateProjectIds = new Set(
    projects.filter((p) => !p.isTemplate).map((p) => p.id),
  );
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const matched = sortMyOpenTasks(
    filterMyOpenTasks(rows, organizationId, userId, nonTemplateProjectIds),
  ).slice(0, limit);

  const withRelations = await attachTaskRelations(organizationId, matched);

  const tasks = withRelations.map((t) => {
    const p = projectMap.get(t.projectId);
    return {
      ...t,
      project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null,
    };
  });

  return serialize(tasks);
}
