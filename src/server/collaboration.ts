"use server";

import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext } from "@/lib/org-context";
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

// ─── Comments + Review Markers ────────────────────────────────────────────────
//
// createThread / addComment / setThreadBlocking / resolveThread / reopenThread /
// setReviewMarker moved BROWSER-DIRECT in Phase 3 — the Convex mutations now run
// the 4-guard bar (RBAC on the blocking/resolve/reopen paths, actor pinned to the
// verified token). See convex/collaboration.ts + src/hooks/use-collaboration-writes.ts.
// The presence/lock actions above remain server-mediated (service token) until the
// presence/lock browser-direct slice lands.

// ─── Activity ─────────────────────────────────────────────────────────────────
//
// Activity events that originate from other server mutations (e.g. quote /
// line-item edits) are written via the plain library helper
// `writeCollabActivityEvent` in "@/lib/collaboration-activity" — NOT a server
// action, so it is not exposed as a public endpoint. The collaboration
// lifecycle events (comments, blocking, resolve/reopen, review markers) are
// logged atomically inside their Convex mutations in convex/collaboration.ts.
