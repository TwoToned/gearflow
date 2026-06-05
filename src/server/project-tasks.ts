"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import type { Prisma } from "@/generated/prisma/client";
import type { ChecklistItem, ProjectTaskStatus, ProjectTaskPriority } from "@/lib/project-tasks";

const taskInclude = {
  assigneeUser: { select: { id: true, name: true, image: true } },
  assigneeCrew: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ProjectTaskInclude;

/** Validate that an assignee (user member or crew) belongs to the org. Throws otherwise. */
async function assertAssigneeInOrg(
  organizationId: string,
  assigneeUserId?: string | null,
  assigneeCrewId?: string | null,
) {
  if (assigneeUserId) {
    const member = await prisma.member.findFirst({
      where: { organizationId, userId: assigneeUserId },
      select: { id: true },
    });
    if (!member) throw new Error("Assigned user is not a member of this organization");
  }
  if (assigneeCrewId) {
    const crew = await prisma.crewMember.findFirst({
      where: { id: assigneeCrewId, organizationId },
      select: { id: true },
    });
    if (!crew) throw new Error("Assigned crew member not found");
  }
}

function normaliseChecklist(checklist?: ChecklistItem[] | null): Prisma.InputJsonValue | undefined {
  if (checklist === undefined) return undefined;
  if (checklist === null) return [] as unknown as Prisma.InputJsonValue;
  return checklist.map((c) => ({ id: c.id, text: c.text, done: !!c.done })) as unknown as Prisma.InputJsonValue;
}

/**
 * People a task can be assigned to: org members (users) + crew members. Gated on
 * project read so anyone who can view a project can populate the assignee picker
 * (no separate orgMembers permission needed).
 */
export async function getTaskAssignees() {
  const { organizationId } = await requirePermission("project", "read");

  const [members, crew] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId },
      select: { user: { select: { id: true, name: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.crewMember.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
  ]);

  return serialize({
    users: members.map((m) => m.user).filter(Boolean),
    crew,
  });
}

export async function getProjectTasks(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");

  const tasks = await prisma.projectTask.findMany({
    where: { organizationId, projectId },
    include: taskInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

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

  // Project must belong to the caller's org.
  const project = await prisma.project.findFirst({
    where: { id: data.projectId, organizationId },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project not found");

  await assertAssigneeInOrg(organizationId, data.assigneeUserId, data.assigneeCrewId);

  // Append to the end of the list.
  const last = await prisma.projectTask.findFirst({
    where: { organizationId, projectId: data.projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const status = data.status ?? "TODO";
  const task = await prisma.projectTask.create({
    data: {
      organizationId,
      projectId: data.projectId,
      title,
      description: data.description?.trim() || null,
      status,
      priority: data.priority ?? "NORMAL",
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      assigneeUserId: data.assigneeUserId || null,
      assigneeCrewId: data.assigneeCrewId || null,
      checklist: normaliseChecklist(data.checklist) ?? undefined,
      createdById: userId,
      completedAt: status === "DONE" ? new Date() : null,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
    include: taskInclude,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "ProjectTask",
    entityId: task.id,
    entityName: task.title,
    summary: `Added task "${task.title}"`,
    projectId: data.projectId,
  });

  return serialize(task);
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

  const existing = await prisma.projectTask.findFirst({
    where: { id, organizationId },
    select: { id: true, projectId: true, status: true },
  });
  if (!existing) throw new Error("Task not found");

  if (data.title !== undefined && !data.title.trim()) throw new Error("Task title is required");
  await assertAssigneeInOrg(organizationId, data.assigneeUserId, data.assigneeCrewId);

  // completedAt tracks the DONE transition both directions.
  let completedAt: Date | null | undefined;
  if (data.status !== undefined && data.status !== existing.status) {
    completedAt = data.status === "DONE" ? new Date() : null;
  }

  const task = await prisma.projectTask.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
      ...(data.assigneeUserId !== undefined ? { assigneeUserId: data.assigneeUserId || null } : {}),
      ...(data.assigneeCrewId !== undefined ? { assigneeCrewId: data.assigneeCrewId || null } : {}),
      ...(data.checklist !== undefined ? { checklist: normaliseChecklist(data.checklist) } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
    },
    include: taskInclude,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "ProjectTask",
    entityId: task.id,
    entityName: task.title,
    summary: `Updated task "${task.title}"`,
    projectId: existing.projectId,
  });

  return serialize(task);
}

export async function deleteProjectTask(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "update");

  const existing = await prisma.projectTask.findFirst({
    where: { id, organizationId },
    select: { id: true, title: true, projectId: true },
  });
  if (!existing) throw new Error("Task not found");

  await prisma.projectTask.delete({ where: { id } });

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
 * Persist a new ordering for a project's tasks. Accepts the full ordered list of
 * task ids; writes each row's sortOrder to its index. Scoped to the org so a
 * foreign id can't be reordered into this project.
 */
export async function reorderProjectTasks(projectId: string, orderedIds: string[]) {
  const { organizationId } = await requirePermission("project", "update");

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.projectTask.updateMany({
        where: { id, organizationId, projectId },
        data: { sortOrder: index },
      }),
    ),
  );
}

/**
 * Cross-project "my work": open tasks (not DONE) assigned to the current user,
 * across every project in the org. Powers the user-centric home screen.
 */
export async function getMyOpenTasks(limit = 25) {
  const { organizationId, userId } = await getOrgContext();

  const tasks = await prisma.projectTask.findMany({
    where: {
      organizationId,
      assigneeUserId: userId,
      status: { not: "DONE" },
      project: { isTemplate: false },
    },
    include: {
      ...taskInclude,
      project: { select: { id: true, name: true, projectNumber: true } },
    },
    orderBy: [
      // Nulls last on dueDate so dated tasks surface first.
      { dueDate: { sort: "asc", nulls: "last" } },
      { priority: "desc" },
      { createdAt: "asc" },
    ],
    take: limit,
  });

  return serialize(tasks);
}
