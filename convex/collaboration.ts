import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgRead, requireService } from "./lib/auth";

/**
 * Convex collaboration substrate — presence, edit locks, comment threads,
 * review markers, and activity events.
 *
 * AUTH: all mutations require the trusted backend SERVICE token (writes flow
 * browser → Next.js server action → Convex, same as the rest of the app).
 * Queries use org-scoped user reads: requireOrgRead(ctx, orgId).
 *
 * Presence TTL: 45 s from lastSeenAt. Heartbeat every 15 s.
 * Lock TTL: 40 s from heartbeatAt. Heartbeat every 10 s while editor is open.
 */

// ─── Presence ────────────────────────────────────────────────────────────────

export const heartbeatPresence = mutation({
  args: {
    orgId: v.string(),
    userId: v.string(),
    userName: v.string(),
    userColor: v.string(),
    avatarUrl: v.optional(v.string()),
    entityType: v.string(),
    entityId: v.string(),
    section: v.optional(v.string()),
    mode: v.union(v.literal("viewing"), v.literal("editing")),
    activeTargetType: v.optional(v.string()),
    activeTargetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const now = Date.now();
    const expiresAt = now + 45_000;

    const existing = await ctx.db
      .query("collaborationPresence")
      .withIndex("by_orgId_userId_entityType_entityId", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId).eq("entityType", args.entityType).eq("entityId", args.entityId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userName: args.userName,
        userColor: args.userColor,
        avatarUrl: args.avatarUrl,
        section: args.section,
        mode: args.mode,
        activeTargetType: args.activeTargetType,
        activeTargetId: args.activeTargetId,
        lastSeenAt: now,
        expiresAt,
      });
    } else {
      await ctx.db.insert("collaborationPresence", {
        ...args,
        lastSeenAt: now,
        expiresAt,
      });
    }
  },
});

export const clearPresence = mutation({
  args: { orgId: v.string(), userId: v.string(), entityType: v.string(), entityId: v.string() },
  handler: async (ctx, { orgId, userId, entityType, entityId }) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("collaborationPresence")
      .withIndex("by_orgId_userId_entityType_entityId", (q) =>
        q.eq("orgId", orgId).eq("userId", userId).eq("entityType", entityType).eq("entityId", entityId)
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const listPresence = query({
  args: { orgId: v.string(), entityType: v.string(), entityId: v.string() },
  handler: async (ctx, { orgId, entityType, entityId }) => {
    await requireOrgRead(ctx, orgId);
    const now = Date.now();
    const rows = await ctx.db
      .query("collaborationPresence")
      .withIndex("by_orgId_entityType_entityId", (q) =>
        q.eq("orgId", orgId).eq("entityType", entityType).eq("entityId", entityId)
      )
      .collect();
    return rows.filter((r) => r.expiresAt > now);
  },
});

// ─── Locks ───────────────────────────────────────────────────────────────────

const LOCK_TTL_MS = 40_000; // 30 s grace on top of the 10 s heartbeat interval

export const acquireLock = mutation({
  args: {
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    ownerUserId: v.string(),
    ownerName: v.string(),
    ownerColor: v.string(),
    clientSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("collaborationLocks")
      .withIndex("by_orgId_entityType_entityId_targetType_targetId", (q) =>
        q.eq("orgId", args.orgId).eq("entityType", args.entityType).eq("entityId", args.entityId).eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (existing) {
      const isOwner = existing.ownerUserId === args.ownerUserId && existing.clientSessionId === args.clientSessionId;
      const isStale = existing.expiresAt < now;

      if (isStale || isOwner) {
        await ctx.db.patch(existing._id, {
          ownerUserId: args.ownerUserId,
          ownerName: args.ownerName,
          ownerColor: args.ownerColor,
          clientSessionId: args.clientSessionId,
          heartbeatAt: now,
          expiresAt: now + LOCK_TTL_MS,
          releasedAt: undefined,
          status: "active",
        });
        return { acquired: true, lockId: existing._id as string, isOwner: true };
      }

      return {
        acquired: false,
        lockId: existing._id as string,
        ownerName: existing.ownerName,
        ownerUserId: existing.ownerUserId,
        ownerColor: existing.ownerColor,
        expiresAt: existing.expiresAt,
      };
    }

    const lockId = await ctx.db.insert("collaborationLocks", {
      orgId: args.orgId,
      entityType: args.entityType,
      entityId: args.entityId,
      targetType: args.targetType,
      targetId: args.targetId,
      ownerUserId: args.ownerUserId,
      ownerName: args.ownerName,
      ownerColor: args.ownerColor,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: now + LOCK_TTL_MS,
      status: "active",
      clientSessionId: args.clientSessionId,
    });
    return { acquired: true, lockId: lockId as string, isOwner: true };
  },
});

export const heartbeatLock = mutation({
  args: {
    orgId: v.string(),
    lockId: v.string(),
    ownerUserId: v.string(),
    clientSessionId: v.string(),
  },
  handler: async (ctx, { orgId, lockId, ownerUserId, clientSessionId }) => {
    await requireService(ctx);
    // Cast string arg to Id for ctx.db.get (Convex Id IS a string at runtime)
    const doc = await ctx.db.get(lockId as unknown as Id<"collaborationLocks">);
    if (!doc || doc.orgId !== orgId || doc.ownerUserId !== ownerUserId || doc.clientSessionId !== clientSessionId || doc.status !== "active") return false;
    const now = Date.now();
    await ctx.db.patch(doc._id, { heartbeatAt: now, expiresAt: now + LOCK_TTL_MS, clientSessionId });
    return true;
  },
});

export const releaseLock = mutation({
  args: { orgId: v.string(), lockId: v.string(), ownerUserId: v.string(), clientSessionId: v.string() },
  handler: async (ctx, { orgId, lockId, ownerUserId, clientSessionId }) => {
    await requireService(ctx);
    const doc = await ctx.db.get(lockId as unknown as Id<"collaborationLocks">);
    if (!doc || doc.orgId !== orgId || doc.ownerUserId !== ownerUserId || doc.clientSessionId !== clientSessionId) return false;
    await ctx.db.patch(doc._id, { status: "released", releasedAt: Date.now() });
    return true;
  },
});

export const takeoverLock = mutation({
  args: {
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    ownerUserId: v.string(),
    ownerName: v.string(),
    ownerColor: v.string(),
    clientSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("collaborationLocks")
      .withIndex("by_orgId_entityType_entityId_targetType_targetId", (q) =>
        q.eq("orgId", args.orgId).eq("entityType", args.entityType).eq("entityId", args.entityId).eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (!existing) return { acquired: false as const, reason: "no_lock" };
    if (existing.expiresAt >= now && existing.ownerUserId !== args.ownerUserId) {
      return { acquired: false as const, reason: "not_stale", ownerName: existing.ownerName };
    }

    await ctx.db.patch(existing._id, {
      ownerUserId: args.ownerUserId,
      ownerName: args.ownerName,
      ownerColor: args.ownerColor,
      clientSessionId: args.clientSessionId,
      heartbeatAt: now,
      expiresAt: now + LOCK_TTL_MS,
    });
    return { acquired: true as const, lockId: existing._id as string };
  },
});

export const getLock = query({
  args: { orgId: v.string(), entityType: v.string(), entityId: v.string(), targetType: v.string(), targetId: v.string() },
  handler: async (ctx, { orgId, entityType, entityId, targetType, targetId }) => {
    await requireOrgRead(ctx, orgId);
    const now = Date.now();
    const lock = await ctx.db
      .query("collaborationLocks")
      .withIndex("by_orgId_entityType_entityId_targetType_targetId", (q) =>
        q.eq("orgId", orgId).eq("entityType", entityType).eq("entityId", entityId).eq("targetType", targetType).eq("targetId", targetId)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (!lock) return null;
    return { ...lock, isStale: lock.expiresAt < now };
  },
});

export const listLocksForEntity = query({
  args: { orgId: v.string(), entityType: v.string(), entityId: v.string() },
  handler: async (ctx, { orgId, entityType, entityId }) => {
    await requireOrgRead(ctx, orgId);
    const now = Date.now();
    const locks = await ctx.db
      .query("collaborationLocks")
      .withIndex("by_orgId_entityType_entityId_targetType_targetId", (q) =>
        q.eq("orgId", orgId).eq("entityType", entityType).eq("entityId", entityId)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    return locks.map((l) => ({ ...l, isStale: l.expiresAt < now }));
  },
});

// ─── Activity logging helper (internal) ───────────────────────────────────────

/**
 * Insert a collaboration activity event. Called inline from the comment / marker
 * mutations so the realtime feed write is atomic with the state change. Best
 * practice elsewhere logs from the trusted server-action layer; here the actor
 * identity is already on the mutation args, so logging in-band avoids an extra
 * round trip and a second thread read.
 */
/** Human-readable " on a <thing>" suffix for activity summaries. */
function targetLabel(targetType?: string): string {
  if (targetType === "group") return " on a group";
  if (targetType === "lineItem") return " on a line item";
  if (targetType === "category") return " on a category";
  return "";
}

type ActivityEventInput = {
  orgId: string;
  actorUserId: string;
  actorName: string;
  actorColor: string;
  entityType: string;
  entityId: string;
  targetType?: string;
  targetId?: string;
  action: string;
  summary: string;
  metadata?: unknown;
};

async function recordActivity(
  ctx: MutationCtx,
  args: ActivityEventInput,
) {
  await ctx.db.insert("activityEvents", { ...args, createdAt: Date.now() });
}

// ─── Comment Threads ─────────────────────────────────────────────────────────

export const listThreads = query({
  args: {
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, entityType, entityId, targetType, targetId }) => {
    await requireOrgRead(ctx, orgId);
    if (targetId) {
      return await ctx.db
        .query("commentThreads")
        .withIndex("by_orgId_targetId", (q) => q.eq("orgId", orgId).eq("targetId", targetId))
        .filter((q) =>
          q.and(
            q.eq(q.field("entityType"), entityType),
            q.eq(q.field("entityId"), entityId),
            q.eq(q.field("targetType"), targetType)
          )
        )
        .collect();
    }
    return await ctx.db
      .query("commentThreads")
      .withIndex("by_orgId_entityId", (q) => q.eq("orgId", orgId).eq("entityId", entityId))
      .collect();
  },
});

export const createThread = mutation({
  args: {
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    firstComment: v.string(),
    createdBy: v.string(),
    createdByName: v.string(),
    authorColor: v.string(),
    isBlocking: v.optional(v.boolean()),
    projectId: v.optional(v.string()),
    mentionUserIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const now = Date.now();
    // For "project" entities the entityId already IS the project id; fall back to
    // it so blocking summaries always have a project to group by.
    const projectId =
      args.projectId ?? (args.entityType === "project" ? args.entityId : undefined);
    const mentions = args.mentionUserIds?.length ? args.mentionUserIds : undefined;
    const threadId = await ctx.db.insert("commentThreads", {
      orgId: args.orgId,
      entityType: args.entityType,
      entityId: args.entityId,
      targetType: args.targetType,
      targetId: args.targetId,
      status: "open",
      isBlocking: args.isBlocking ?? false,
      projectId,
      mentionUserIds: mentions,
      createdBy: args.createdBy,
      createdByName: args.createdByName,
      createdAt: now,
      updatedAt: now,
    });
    // threadId is Id<"commentThreads"> which IS a string at runtime
    await ctx.db.insert("comments", {
      orgId: args.orgId,
      threadId: threadId as unknown as string,
      body: args.firstComment,
      authorId: args.createdBy,
      authorName: args.createdByName,
      authorColor: args.authorColor,
      mentionUserIds: mentions,
      createdAt: now,
    });

    const where = targetLabel(args.targetType);
    await recordActivity(ctx, {
      orgId: args.orgId,
      actorUserId: args.createdBy,
      actorName: args.createdByName,
      actorColor: args.authorColor,
      entityType: args.entityType,
      entityId: args.entityId,
      targetType: args.targetType,
      targetId: args.targetId,
      action: args.isBlocking ? "comment_blocking_created" : "comment_created",
      summary: args.isBlocking
        ? `added a blocking comment${where}`
        : `started a discussion${where}`,
      metadata: { threadId: threadId as string },
    });
    return threadId as string;
  },
});

export const addComment = mutation({
  args: {
    orgId: v.string(),
    threadId: v.string(),
    body: v.string(),
    authorId: v.string(),
    authorName: v.string(),
    authorColor: v.string(),
    mentionUserIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const now = Date.now();

    const thread = await ctx.db.get(args.threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== args.orgId) throw new Error("Thread not found");

    // Resolved threads are closed for replies: the reviewer must explicitly
    // reopen first (which requires project manage_line_items). This keeps the
    // resolved state authoritative instead of silently reopening on any reply.
    if (thread.status === "resolved") {
      throw new Error(
        "This discussion is resolved. Reopen it before replying.",
      );
    }

    // Union any new mentions onto the thread so dashboard mention detection
    // covers replies, not just the opening comment.
    const newMentions = args.mentionUserIds?.length ? args.mentionUserIds : [];
    const mergedMentions = Array.from(
      new Set([...(thread.mentionUserIds ?? []), ...newMentions]),
    );

    await ctx.db.patch(thread._id, {
      updatedAt: now,
      mentionUserIds: mergedMentions.length ? mergedMentions : undefined,
    });

    const commentId = await ctx.db.insert("comments", {
      orgId: args.orgId,
      threadId: args.threadId,
      body: args.body,
      authorId: args.authorId,
      authorName: args.authorName,
      authorColor: args.authorColor,
      mentionUserIds: newMentions.length ? newMentions : undefined,
      createdAt: now,
    });

    await recordActivity(ctx, {
      orgId: args.orgId,
      actorUserId: args.authorId,
      actorName: args.authorName,
      actorColor: args.authorColor,
      entityType: thread.entityType,
      entityId: thread.entityId,
      targetType: thread.targetType,
      targetId: thread.targetId,
      action: "comment_added",
      summary: `replied to a discussion${targetLabel(thread.targetType)}`,
      metadata: { threadId: args.threadId },
    });

    return commentId;
  },
});

export const setThreadBlocking = mutation({
  args: {
    orgId: v.string(),
    threadId: v.string(),
    isBlocking: v.boolean(),
    actorUserId: v.optional(v.string()),
    actorName: v.optional(v.string()),
    actorColor: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, threadId, isBlocking, actorUserId, actorName, actorColor }) => {
    await requireService(ctx);
    const thread = await ctx.db.get(threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== orgId) throw new Error("Thread not found");
    await ctx.db.patch(thread._id, { isBlocking, updatedAt: Date.now() });
    if (actorUserId && actorName && actorColor) {
      await recordActivity(ctx, {
        orgId,
        actorUserId,
        actorName,
        actorColor,
        entityType: thread.entityType,
        entityId: thread.entityId,
        targetType: thread.targetType,
        targetId: thread.targetId,
        action: isBlocking ? "thread_blocked" : "thread_unblocked",
        summary: isBlocking
          ? `marked a comment as blocking${targetLabel(thread.targetType)}`
          : `cleared the blocking flag${targetLabel(thread.targetType)}`,
        metadata: { threadId },
      });
    }
  },
});

export const resolveThread = mutation({
  args: {
    orgId: v.string(),
    threadId: v.string(),
    resolvedBy: v.string(),
    actorName: v.optional(v.string()),
    actorColor: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, threadId, resolvedBy, actorName, actorColor }) => {
    await requireService(ctx);
    const thread = await ctx.db.get(threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== orgId) throw new Error("Thread not found");
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      status: "resolved",
      resolvedBy,
      resolvedAt: now,
      updatedAt: now,
    });
    if (actorName && actorColor) {
      await recordActivity(ctx, {
        orgId,
        actorUserId: resolvedBy,
        actorName,
        actorColor,
        entityType: thread.entityType,
        entityId: thread.entityId,
        targetType: thread.targetType,
        targetId: thread.targetId,
        action: "thread_resolved",
        summary: `resolved a discussion${targetLabel(thread.targetType)}`,
        metadata: { threadId },
      });
    }
  },
});

export const reopenThread = mutation({
  args: {
    orgId: v.string(),
    threadId: v.string(),
    actorUserId: v.optional(v.string()),
    actorName: v.optional(v.string()),
    actorColor: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, threadId, actorUserId, actorName, actorColor }) => {
    await requireService(ctx);
    const thread = await ctx.db.get(threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== orgId) throw new Error("Thread not found");
    await ctx.db.patch(thread._id, {
      status: "open",
      resolvedBy: undefined,
      resolvedAt: undefined,
      updatedAt: Date.now(),
    });
    if (actorUserId && actorName && actorColor) {
      await recordActivity(ctx, {
        orgId,
        actorUserId,
        actorName,
        actorColor,
        entityType: thread.entityType,
        entityId: thread.entityId,
        targetType: thread.targetType,
        targetId: thread.targetId,
        action: "thread_reopened",
        summary: `reopened a discussion${targetLabel(thread.targetType)}`,
        metadata: { threadId },
      });
    }
  },
});

export const listComments = query({
  args: { orgId: v.string(), threadId: v.string() },
  handler: async (ctx, { orgId, threadId }) => {
    await requireOrgRead(ctx, orgId);
    const thread = await ctx.db.get(threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== orgId) return [];
    const rows = await ctx.db
      .query("comments")
      .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", threadId))
      .collect();
    return rows.filter((c) => c.orgId === orgId && !c.deletedAt);
  },
});

// ─── Review Markers ───────────────────────────────────────────────────────────

export const getReviewMarker = query({
  args: { orgId: v.string(), entityId: v.string(), targetId: v.string() },
  handler: async (ctx, { orgId, entityId, targetId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("reviewMarkers")
      .withIndex("by_orgId_targetId", (q) => q.eq("orgId", orgId).eq("targetId", targetId))
      .filter((q) => q.eq(q.field("entityId"), entityId))
      .first();
  },
});

export const listReviewMarkersForEntity = query({
  args: { orgId: v.string(), entityType: v.string(), entityId: v.string() },
  handler: async (ctx, { orgId, entityType, entityId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("reviewMarkers")
      .withIndex("by_orgId_entityId", (q) => q.eq("orgId", orgId).eq("entityId", entityId))
      .filter((q) => q.eq(q.field("entityType"), entityType))
      .collect();
  },
});

export const setReviewMarker = mutation({
  args: {
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    status: v.union(v.literal("needs_review"), v.literal("follow_up"), v.literal("resolved")),
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
    createdBy: v.string(),
    createdByName: v.string(),
    actorColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("reviewMarkers")
      .withIndex("by_orgId_targetId", (q) =>
        q.eq("orgId", args.orgId).eq("targetId", args.targetId)
      )
      .filter((q) => q.eq(q.field("entityId"), args.entityId))
      .first();

    const logMarker = async () => {
      if (!args.actorColor) return;
      await recordActivity(ctx, {
        orgId: args.orgId,
        actorUserId: args.createdBy,
        actorName: args.createdByName,
        actorColor: args.actorColor,
        entityType: args.entityType,
        entityId: args.entityId,
        targetType: args.targetType,
        targetId: args.targetId,
        action: `review_${args.status}`,
        summary: reviewMarkerSummary(args.status, args.targetType),
        metadata: { reason: args.reason },
      });
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        reason: args.reason,
        note: args.note,
        updatedAt: now,
        resolvedBy: args.status === "resolved" ? args.createdBy : undefined,
        resolvedAt: args.status === "resolved" ? now : undefined,
      });
      await logMarker();
      return existing._id as string;
    }

    const id = (await ctx.db.insert("reviewMarkers", {
      orgId: args.orgId,
      entityType: args.entityType,
      entityId: args.entityId,
      targetType: args.targetType,
      targetId: args.targetId,
      status: args.status,
      reason: args.reason,
      note: args.note,
      createdBy: args.createdBy,
      createdByName: args.createdByName,
      createdAt: now,
      updatedAt: now,
    })) as string;
    await logMarker();
    return id;
  },
});

/** Activity summary for a review-marker change. */
function reviewMarkerSummary(
  status: "needs_review" | "follow_up" | "resolved",
  targetType?: string,
): string {
  const where = targetLabel(targetType);
  if (status === "needs_review") return `flagged for review${where}`;
  if (status === "follow_up") return `flagged a follow-up${where}`;
  return `marked review resolved${where}`;
}

// ─── Activity Events ──────────────────────────────────────────────────────────

export const logActivityEvent = mutation({
  args: {
    orgId: v.string(),
    actorUserId: v.string(),
    actorName: v.string(),
    actorColor: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    action: v.string(),
    summary: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    await ctx.db.insert("activityEvents", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const listActivityEvents = query({
  args: {
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, entityType, entityId, limit }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("activityEvents")
      .withIndex("by_orgId_entityId_createdAt", (q) =>
        q.eq("orgId", orgId).eq("entityId", entityId)
      )
      .order("desc")
      .take(limit ?? 50);
    // filter in-memory since index already narrows to entityId
    return rows.filter((r) => r.entityType === entityType);
  },
});

export const listThreadCommentCounts = query({
  args: {
    orgId: v.string(),
    entityType: v.string(),
    entityId: v.string(),
  },
  handler: async (ctx, { orgId, entityType, entityId }) => {
    await requireOrgRead(ctx, orgId);
    const threads = await ctx.db
      .query("commentThreads")
      .withIndex("by_orgId_entityId", (q) => q.eq("orgId", orgId).eq("entityId", entityId))
      .filter((q) => q.eq(q.field("entityType"), entityType))
      .collect();

    const counts: Record<string, { open: number; total: number; blockingOpen: number }> = {};
    for (const t of threads) {
      const key = t.targetId ?? "__entity__";
      if (!counts[key]) counts[key] = { open: 0, total: 0, blockingOpen: 0 };
      counts[key].total++;
      if (t.status === "open") {
        counts[key].open++;
        if (t.isBlocking) counts[key].blockingOpen++;
      }
    }
    return counts;
  },
});

// ─── Blocking Comment Summaries ────────────────────────────────────────────────

/**
 * Open blocking threads for a single project, summarised. Drives the project
 * header badge, line-item indicators, and the server-side prep/send-out gate.
 * `lineItemTargetIds` is the set of line items with an open blocking thread;
 * `hasProjectLevel` is true when a project-level (no specific target) blocker is
 * open, which gates everything.
 */
export const getProjectBlockingSummary = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgRead(ctx, orgId);
    const threads = await ctx.db
      .query("commentThreads")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
      .collect();
    const open = threads.filter((t) => t.status === "open" && t.isBlocking);
    const lineItemTargetIds: string[] = [];
    const groupTargetIds: string[] = [];
    let hasProjectLevel = false;
    for (const t of open) {
      if (t.targetType === "lineItem" && t.targetId) lineItemTargetIds.push(t.targetId);
      else if (t.targetType === "group" && t.targetId) groupTargetIds.push(t.targetId);
      else if (!t.targetId) hasProjectLevel = true;
    }
    return {
      count: open.length,
      lineItemTargetIds,
      groupTargetIds,
      hasProjectLevel,
      targetIds: open.map((t) => t.targetId ?? null),
    };
  },
});

/**
 * Blocking counts for many projects at once (project list / dashboard cards).
 * Scans the org's blocking threads once via the by_orgId_isBlocking index and
 * buckets the open ones by project.
 */
export const listBlockingForProjects = query({
  args: { orgId: v.string(), projectIds: v.array(v.string()) },
  handler: async (ctx, { orgId, projectIds }) => {
    await requireOrgRead(ctx, orgId);
    const wanted = new Set(projectIds);
    const blocking = await ctx.db
      .query("commentThreads")
      .withIndex("by_orgId_isBlocking_status", (q) =>
        q.eq("orgId", orgId).eq("isBlocking", true).eq("status", "open"),
      )
      .collect();
    const counts: Record<string, number> = {};
    for (const t of blocking) {
      const pid = t.projectId ?? t.entityId;
      if (!wanted.has(pid)) continue;
      counts[pid] = (counts[pid] ?? 0) + 1;
    }
    return counts;
  },
});

/**
 * All open blocking threads in the org, with their opening comment snippet.
 * The trusted Next.js layer joins these to project name + PM for the dashboard
 * (PM-of / mentioned-in surfaces). Kept org-wide because blocking threads are
 * rare; the by_orgId_isBlocking index keeps the scan tight.
 */
export const listOpenBlockingThreads = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const blocking = await ctx.db
      .query("commentThreads")
      .withIndex("by_orgId_isBlocking_status", (q) =>
        q.eq("orgId", orgId).eq("isBlocking", true).eq("status", "open"),
      )
      .collect();
    const out = [];
    for (const t of blocking) {
      const first = await ctx.db
        .query("comments")
        .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", t._id as unknown as string))
        .first();
      out.push({
        threadId: t._id as string,
        projectId: t.projectId ?? t.entityId,
        entityType: t.entityType,
        entityId: t.entityId,
        targetType: t.targetType ?? null,
        targetId: t.targetId ?? null,
        createdByName: t.createdByName,
        createdAt: t.createdAt,
        mentionUserIds: t.mentionUserIds ?? [],
        snippet: first?.body ?? "",
      });
    }
    return out;
  },
});
