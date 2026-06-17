"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { syncProjectManagersToConvex } from "@/lib/project-subtable-mirror";
import { getProjectManagerRows } from "@/lib/project-managers-read";

export async function getProjectManagers(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");

  // projectManager rows come from Convex (dual-written). The `user` half is
  // Better Auth and stays a batched Prisma lookup.
  const rows = await getProjectManagerRows(organizationId, projectId);

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, image: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const managers = rows.map((r) => ({
    ...r,
    user: userMap.get(r.userId) ?? null,
  }));

  return serialize(managers);
}

export async function addProjectManager(projectId: string, userId: string) {
  const { organizationId, userId: actorId, userName } = await requirePermission(
    "project",
    "manage"
  );

  // Verify user belongs to org
  const membership = await prisma.member.findFirst({
    where: { organizationId, userId },
  });
  if (!membership) {
    throw new Error("User is not a member of this organization");
  }

  const manager = await prisma.projectManager.create({
    data: {
      organizationId,
      projectId,
      userId,
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
  });

  await syncProjectManagersToConvex(organizationId, projectId);

  await logActivity({
    organizationId,
    userId: actorId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: projectId,
    entityName: manager.user.name ?? manager.user.email,
    summary: `Added ${manager.user.name ?? manager.user.email} as project manager`,
  });

  return serialize(manager);
}

export async function removeProjectManager(projectId: string, userId: string) {
  const { organizationId, userId: actorId, userName } = await requirePermission(
    "project",
    "manage"
  );

  const manager = await prisma.projectManager.findFirst({
    where: { projectId, userId, organizationId },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!manager) {
    throw new Error("Project manager assignment not found");
  }

  await prisma.projectManager.delete({
    where: { id: manager.id },
  });

  await syncProjectManagersToConvex(organizationId, projectId);

  await logActivity({
    organizationId,
    userId: actorId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: projectId,
    entityName: manager.user.name ?? manager.user.email,
    summary: `Removed ${manager.user.name ?? manager.user.email} as project manager`,
  });

  return serialize({ success: true });
}
