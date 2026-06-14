import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query, mutation } from "./_generated/server";
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
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const now = Date.now();
    const threadId = await ctx.db.insert("commentThreads", {
      orgId: args.orgId,
      entityType: args.entityType,
      entityId: args.entityId,
      targetType: args.targetType,
      targetId: args.targetId,
      status: "open",
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
      createdAt: now,
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
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const now = Date.now();

    const thread = await ctx.db.get(args.threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== args.orgId) throw new Error("Thread not found");

    if (thread.status === "resolved") {
      await ctx.db.patch(thread._id, {
        status: "open",
        resolvedBy: undefined,
        resolvedAt: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(thread._id, { updatedAt: now });
    }

    return await ctx.db.insert("comments", {
      orgId: args.orgId,
      threadId: args.threadId,
      body: args.body,
      authorId: args.authorId,
      authorName: args.authorName,
      authorColor: args.authorColor,
      createdAt: now,
    });
  },
});

export const resolveThread = mutation({
  args: { orgId: v.string(), threadId: v.string(), resolvedBy: v.string() },
  handler: async (ctx, { orgId, threadId, resolvedBy }) => {
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
  },
});

export const reopenThread = mutation({
  args: { orgId: v.string(), threadId: v.string() },
  handler: async (ctx, { orgId, threadId }) => {
    await requireService(ctx);
    const thread = await ctx.db.get(threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== orgId) throw new Error("Thread not found");
    await ctx.db.patch(thread._id, {
      status: "open",
      resolvedBy: undefined,
      resolvedAt: undefined,
      updatedAt: Date.now(),
    });
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

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        reason: args.reason,
        note: args.note,
        updatedAt: now,
        resolvedBy: args.status === "resolved" ? args.createdBy : undefined,
        resolvedAt: args.status === "resolved" ? now : undefined,
      });
      return existing._id as string;
    }

    return (await ctx.db.insert("reviewMarkers", {
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
  },
});

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

    const counts: Record<string, { open: number; total: number }> = {};
    for (const t of threads) {
      const key = t.targetId ?? "__entity__";
      if (!counts[key]) counts[key] = { open: 0, total: 0 };
      counts[key].total++;
      if (t.status === "open") counts[key].open++;
    }
    return counts;
  },
});
