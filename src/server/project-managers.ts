"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";

export async function getProjectManagers(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");

  const managers = await prisma.projectManager.findMany({
    where: { projectId, organizationId },
    include: {
      user: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
    orderBy: { addedAt: "asc" },
  });

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

  await logActivity({
    organizationId,
    userId: actorId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: projectId,
    details: `Added ${manager.user.name ?? manager.user.email} as project manager`,
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

  await logActivity({
    organizationId,
    userId: actorId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: projectId,
    details: `Removed ${manager.user.name ?? manager.user.email} as project manager`,
  });

  return serialize({ success: true });
}
