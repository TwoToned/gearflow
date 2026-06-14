"use server";

import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getUserColor } from "@/lib/collaboration-colors";
import { serialize } from "@/lib/serialize";

/**
 * Server actions for the collaboration substrate.
 *
 * All Convex mutations require the service token (browser writes are rejected).
 * Server actions are the trusted bridge: browser → Next.js server action →
 * Convex (service token). Org scoping is validated via getOrgContext().
 */

// ─── Presence ─────────────────────────────────────────────────────────────────

export async function heartbeatPresence(
  entityType: string,
  entityId: string,
  mode: "viewing" | "editing",
  section?: string,
  activeTargetType?: string,
  activeTargetId?: string
) {
  const ctx = await getOrgContext();
  const userColor = getUserColor(ctx.userId);
  const convex = await getConvexClient();

  await convex.mutation(api.collaboration.heartbeatPresence, {
    orgId: ctx.organizationId,
    userId: ctx.userId,
    userName: ctx.userName,
    userColor,
    avatarUrl: ctx.user.image ?? undefined,
    entityType,
    entityId,
    section,
    mode,
    activeTargetType,
    activeTargetId,
  });

  return serialize({ ok: true });
}

export async function clearPresence(entityType: string, entityId: string) {
  const ctx = await getOrgContext();
  const convex = await getConvexClient();
  await convex.mutation(api.collaboration.clearPresence, {
    orgId: ctx.organizationId,
    userId: ctx.userId,
    entityType,
    entityId,
  });
  return serialize({ ok: true });
}

// ─── Locks ────────────────────────────────────────────────────────────────────

export async function acquireLock(
  entityType: string,
  entityId: string,
  targetType: string,
  targetId: string,
  clientSessionId: string
) {
  const ctx = await getOrgContext();
  const userColor = getUserColor(ctx.userId);
  const convex = await getConvexClient();

  const result = await convex.mutation(api.collaboration.acquireLock, {
    orgId: ctx.organizationId,
    entityType,
    entityId,
    targetType,
    targetId,
    ownerUserId: ctx.userId,
    ownerName: ctx.userName,
    ownerColor: userColor,
    clientSessionId,
  });

  return serialize(result);
}

export async function heartbeatLock(lockId: string, clientSessionId: string) {
  const ctx = await getOrgContext();
  const convex = await getConvexClient();
  const ok = await convex.mutation(api.collaboration.heartbeatLock, {
    orgId: ctx.organizationId,
    lockId,
    ownerUserId: ctx.userId,
    clientSessionId,
  });
  return serialize({ ok });
}

export async function releaseLock(lockId: string, clientSessionId: string) {
  const ctx = await getOrgContext();
  const convex = await getConvexClient();
  await convex.mutation(api.collaboration.releaseLock, {
    orgId: ctx.organizationId,
    lockId,
    ownerUserId: ctx.userId,
    clientSessionId,
  });
  return serialize({ ok: true });
}

export async function takeoverLock(
  entityId: string,
  targetId: string,
  entityType: string,
  targetType: string,
  clientSessionId: string
) {
  const ctx = await getOrgContext();
  const userColor = getUserColor(ctx.userId);
  const convex = await getConvexClient();
  const result = await convex.mutation(api.collaboration.takeoverLock, {
    orgId: ctx.organizationId,
    entityType,
    entityId,
    targetType,
    targetId,
    ownerUserId: ctx.userId,
    ownerName: ctx.userName,
    ownerColor: userColor,
    clientSessionId,
  });
  return serialize(result);
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export async function createThread(
  entityType: string,
  entityId: string,
  firstComment: string,
  targetType?: string,
  targetId?: string,
  options?: { isBlocking?: boolean; mentionUserIds?: string[]; projectId?: string }
) {
  const ctx = await getOrgContext();
  if (options?.isBlocking) {
    await requirePermission("project", "manage_line_items");
  }
  const userColor = getUserColor(ctx.userId);
  const convex = await getConvexClient();
  const threadId = await convex.mutation(api.collaboration.createThread, {
    orgId: ctx.organizationId,
    entityType,
    entityId,
    targetType,
    targetId,
    firstComment,
    createdBy: ctx.userId,
    createdByName: ctx.userName,
    authorColor: userColor,
    isBlocking: options?.isBlocking ?? false,
    projectId: options?.projectId,
    mentionUserIds: options?.mentionUserIds,
  });
  return serialize({ threadId: threadId as unknown as string });
}

export async function addComment(
  threadId: string,
  body: string,
  options?: { mentionUserIds?: string[] }
) {
  const ctx = await getOrgContext();
  const userColor = getUserColor(ctx.userId);
  const convex = await getConvexClient();
  await convex.mutation(api.collaboration.addComment, {
    orgId: ctx.organizationId,
    threadId,
    body,
    authorId: ctx.userId,
    authorName: ctx.userName,
    authorColor: userColor,
    mentionUserIds: options?.mentionUserIds,
  });
  return serialize({ ok: true });
}

export async function setThreadBlocking(threadId: string, isBlocking: boolean) {
  const ctx = await getOrgContext();
  await requirePermission("project", "manage_line_items");
  const convex = await getConvexClient();
  await convex.mutation(api.collaboration.setThreadBlocking, {
    orgId: ctx.organizationId,
    threadId,
    isBlocking,
  });
  return serialize({ ok: true });
}

export async function resolveThread(threadId: string) {
  const ctx = await getOrgContext();
  const convex = await getConvexClient();
  await convex.mutation(api.collaboration.resolveThread, {
    orgId: ctx.organizationId,
    threadId,
    resolvedBy: ctx.userId,
  });
  return serialize({ ok: true });
}

export async function reopenThread(threadId: string) {
  const ctx = await getOrgContext();
  const convex = await getConvexClient();
  await convex.mutation(api.collaboration.reopenThread, {
    orgId: ctx.organizationId,
    threadId,
  });
  return serialize({ ok: true });
}

// ─── Review Markers ──────────────────────────────────────────────────────────

export async function setReviewMarker(
  entityType: string,
  entityId: string,
  targetType: string,
  targetId: string,
  status: "needs_review" | "follow_up" | "resolved",
  reason?: string,
  note?: string
) {
  const ctx = await getOrgContext();
  const convex = await getConvexClient();
  await convex.mutation(api.collaboration.setReviewMarker, {
    orgId: ctx.organizationId,
    entityType,
    entityId,
    targetType,
    targetId,
    status,
    reason,
    note,
    createdBy: ctx.userId,
    createdByName: ctx.userName,
  });
  return serialize({ ok: true });
}

// ─── Activity ─────────────────────────────────────────────────────────────────

export async function logCollabActivity(
  entityType: string,
  entityId: string,
  action: string,
  summary: string,
  targetType?: string,
  targetId?: string,
  metadata?: Record<string, unknown>
) {
  const ctx = await getOrgContext();
  const userColor = getUserColor(ctx.userId);
  const convex = await getConvexClient();
  await convex.mutation(api.collaboration.logActivityEvent, {
    orgId: ctx.organizationId,
    actorUserId: ctx.userId,
    actorName: ctx.userName,
    actorColor: userColor,
    entityType,
    entityId,
    targetType,
    targetId,
    action,
    summary,
    metadata,
  });
  return serialize({ ok: true });
}
