"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
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

/**
 * Set a project's managers to exactly `userIds` in ONE server round-trip + ONE
 * atomic Convex mutation. Replaces the client-side
 * `Promise.all([...toAdd.map(addProjectManager), ...toRemove.map(removeProjectManager)])`
 * fan-out (one round-trip per changed manager) in the project wizard/edit form.
 *
 * The diff is computed server-side from the current rows, so callers pass the
 * full desired set and never compute the delta themselves. Same validation
 * (added users must be org members) and per-add / per-remove audit logging as the
 * single addProjectManager / removeProjectManager actions.
 */
export async function setProjectManagers(projectId: string, userIds: string[]) {
  const { organizationId, userId: actorId, userName } = await requirePermission(
    "project",
    "manage"
  );

  const desired = [...new Set(userIds)];
  const convex = await getConvexClient();
  // Pre-write diff read — retry a transient blip so the wizard's post-create
  // manager sync doesn't spuriously fail after the project already committed.
  const current = await withConvexReadRetry(() =>
    convex.query(api.projectManagers.listByProject, { projectId, orgId: organizationId }),
  );
  const currentUserIds = new Set(current.map((r) => r.userId));
  const desiredSet = new Set(desired);

  const toAddUserIds = desired.filter((uid) => !currentUserIds.has(uid));
  const toRemove = current.filter((r) => !desiredSet.has(r.userId));

  // Validate every added user is an org member (Auth table — stays Prisma), in
  // one query rather than per-user (matches addProjectManager's guard).
  if (toAddUserIds.length > 0) {
    const members = await prisma.member.findMany({
      where: { organizationId, userId: { in: toAddUserIds } },
      select: { userId: true },
    });
    const memberSet = new Set(members.map((m) => m.userId));
    const nonMember = toAddUserIds.find((uid) => !memberSet.has(uid));
    if (nonMember) {
      throw new Error("User is not a member of this organization");
    }
  }

  if (toAddUserIds.length === 0 && toRemove.length === 0) {
    return serialize({ added: [], removed: [] });
  }

  const now = Date.now();
  const add = toAddUserIds.map((uid) => ({ id: createId(), userId: uid, addedAt: now }));
  await convex.mutation(api.projectManagers.applyDiff, {
    organizationId,
    projectId,
    add,
    removeIds: toRemove.map((r) => r.id),
  });

  // Fetch user labels for the audit log (added + removed) in one query.
  const logUserIds = [...new Set([...toAddUserIds, ...toRemove.map((r) => r.userId)])];
  const users = logUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: logUserIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const label = (uid: string) => userMap.get(uid)?.name ?? userMap.get(uid)?.email ?? uid;

  for (const uid of toAddUserIds) {
    await logActivity({
      organizationId,
      userId: actorId,
      userName,
      action: "updated",
      entityType: "project",
      entityId: projectId,
      entityName: label(uid),
      summary: `Added ${label(uid)} as project manager`,
    });
  }
  for (const r of toRemove) {
    await logActivity({
      organizationId,
      userId: actorId,
      userName,
      action: "updated",
      entityType: "project",
      entityId: projectId,
      entityName: label(r.userId),
      summary: `Removed ${label(r.userId)} as project manager`,
    });
  }

  return serialize({ added: toAddUserIds, removed: toRemove.map((r) => r.userId) });
}

export async function removeProjectManager(projectId: string, userId: string) {
  const { organizationId, userId: actorId, userName } = await requirePermission(
    "project",
    "manage"
  );

  const convex = await getConvexClient();
  const pmRows = await withConvexReadRetry(() =>
    convex.query(api.projectManagers.listByProject, { projectId, orgId: organizationId }),
  );
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
