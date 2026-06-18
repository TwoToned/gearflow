"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { getProjectManagerRows } from "@/lib/project-managers-read";

export async function getProjectManagers(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");

  // projectManager rows come from Convex. The `user` half is Better Auth and
  // stays a batched Prisma lookup.
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

  // Verify user belongs to org (Auth table — stays Prisma).
  const membership = await prisma.member.findFirst({
    where: { organizationId, userId },
  });
  if (!membership) {
    throw new Error("User is not a member of this organization");
  }

  // Fetch user for return value + log message (Auth — stays Prisma).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true },
  });

  const convex = await getConvexClient();
  const id = createId();
  await convex.mutation(api.projectManagers.createIfMissing, {
    id,
    organizationId,
    projectId,
    userId,
    addedAt: Date.now(),
  });

  await logActivity({
    organizationId,
    userId: actorId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: projectId,
    entityName: user?.name ?? user?.email ?? userId,
    summary: `Added ${user?.name ?? user?.email ?? userId} as project manager`,
  });

  return serialize({ id, organizationId, projectId, userId, user: user ?? null });
}

export async function removeProjectManager(projectId: string, userId: string) {
  const { organizationId, userId: actorId, userName } = await requirePermission(
    "project",
    "manage"
  );

  const convex = await getConvexClient();
  const pmRows = await convex.query(api.projectManagers.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const manager = pmRows.find((r) => r.userId === userId && r.organizationId === organizationId);

  if (!manager) {
    throw new Error("Project manager assignment not found");
  }

  // Fetch user for log message (Auth — stays Prisma).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await convex.mutation(api.projectManagers.remove, { id: manager.id });

  await logActivity({
    organizationId,
    userId: actorId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: projectId,
    entityName: user?.name ?? user?.email ?? userId,
    summary: `Removed ${user?.name ?? user?.email ?? userId} as project manager`,
  });

  return serialize({ success: true });
}
