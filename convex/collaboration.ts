import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgReadFor, requireOrgPermission, requireService, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { getUserColor } from "./lib/collaborationColors";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Convex collaboration substrate — comment threads, review markers, and
 * activity events.
 *
 * AUTH: the comment/review-marker WRITES are browser-direct (Phase 3): they run
 * the 4-guard bar — assertWritesEnabled + enforceBrowserWriteLimit +
 * requireOrgRead / requireOrgPermission(project, manage_line_items) + resolveActor
 * (audit identity pinned to the verified token; a client can't spoof the author or
 * the avatar colour, which is recomputed from the pinned userId). All four guards
 * no-op / bypass for the SERVICE token, so the in-flight deployed image (which
 * still calls these via the server action until Coolify ships) is unaffected —
 * backward-compatible expand-contract (colour args relaxed to optional, nothing
 * removed). Only the internal logActivityEvent helper (called by other server
 * mutations) stays SERVICE-gated. Queries use org-scoped, agent-reachable reads:
 * requireOrgReadFor(ctx, orgId, "project").
 */

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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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
    // Relaxed required → optional (expand-contract): the deployed image still sends
    // it; browser-direct callers omit it — the colour is recomputed from the pinned
    // actor below, never trusted from the client.
    authorColor: v.optional(v.string()),
    isBlocking: v.optional(v.boolean()),
    projectId: v.optional(v.string()),
    mentionUserIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await assertWritesEnabled(ctx, "collaboration");
    await enforceBrowserWriteLimit(ctx);
    // A blocking comment feeds the project blocking gate → gate it on
    // manage_line_items (owner/admin/manager/member); a plain discussion is open to
    // any org member. Service token bypasses both.
    if (args.isBlocking) {
      if (args.entityType !== "project") {
        throw new ConvexError("Blocking comments are only supported on projects.");
      }
      await requireOrgPermission(ctx, args.orgId, "project", "manage_line_items");
    } else {
      // A plain discussion is open to any org member — project:read is held by every
      // built-in role, so this is the membership-aware "any member" bar (unlike
      // requireOrgRead, it re-checks the members row, not just the token's orgId claim).
      await requireOrgPermission(ctx, args.orgId, "project", "read");
    }
    const actor = await resolveActor(ctx, { userId: args.createdBy, userName: args.createdByName });
    const color = getUserColor(actor.userId);
    const now = Date.now();
    // For a "project" entity the entityId IS the project id — derive projectId from
    // it and IGNORE any client-supplied projectId, so a blocking thread can't be
    // indexed against (and thus gate) a DIFFERENT project than the one it's on.
    const projectId =
      args.entityType === "project" ? args.entityId : args.projectId;
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
      createdBy: actor.userId,
      createdByName: actor.userName,
      createdAt: now,
      updatedAt: now,
    });
    // threadId is Id<"commentThreads"> which IS a string at runtime
    await ctx.db.insert("comments", {
      orgId: args.orgId,
      threadId: threadId as unknown as string,
      body: args.firstComment,
      authorId: actor.userId,
      authorName: actor.userName,
      authorColor: color,
      mentionUserIds: mentions,
      createdAt: now,
    });

    const where = targetLabel(args.targetType);
    await recordActivity(ctx, {
      orgId: args.orgId,
      actorUserId: actor.userId,
      actorName: actor.userName,
      actorColor: color,
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
    // Relaxed required → optional (expand-contract); colour recomputed from the pinned actor.
    authorColor: v.optional(v.string()),
    mentionUserIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await assertWritesEnabled(ctx, "collaboration");
    await enforceBrowserWriteLimit(ctx);
    // Any org member may reply (membership-aware; project:read is universal).
    await requireOrgPermission(ctx, args.orgId, "project", "read");
    const actor = await resolveActor(ctx, { userId: args.authorId, userName: args.authorName });
    const color = getUserColor(actor.userId);
    const now = Date.now();

    const thread = await ctx.db.get(args.threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== args.orgId) throw new ConvexError("Thread not found");

    // Resolved threads are closed for replies: the reviewer must explicitly
    // reopen first (which requires project manage_line_items). This keeps the
    // resolved state authoritative instead of silently reopening on any reply.
    if (thread.status === "resolved") {
      throw new ConvexError(
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
      authorId: actor.userId,
      authorName: actor.userName,
      authorColor: color,
      mentionUserIds: newMentions.length ? newMentions : undefined,
      createdAt: now,
    });

    await recordActivity(ctx, {
      orgId: args.orgId,
      actorUserId: actor.userId,
      actorName: actor.userName,
      actorColor: color,
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
  handler: async (ctx, { orgId, threadId, isBlocking, actorUserId, actorName }) => {
    await assertWritesEnabled(ctx, "collaboration");
    await enforceBrowserWriteLimit(ctx);
    // Toggling the blocking flag moves the project gate → manage_line_items.
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, { userId: actorUserId ?? "", userName: actorName ?? "" });
    const thread = await ctx.db.get(threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== orgId) throw new ConvexError("Thread not found");
    await ctx.db.patch(thread._id, { isBlocking, updatedAt: Date.now() });
    await recordActivity(ctx, {
      orgId,
      actorUserId: actor.userId,
      actorName: actor.userName,
      actorColor: getUserColor(actor.userId),
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
  handler: async (ctx, { orgId, threadId, resolvedBy, actorName }) => {
    await assertWritesEnabled(ctx, "collaboration");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, { userId: resolvedBy, userName: actorName ?? "" });
    const thread = await ctx.db.get(threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== orgId) throw new ConvexError("Thread not found");
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      status: "resolved",
      resolvedBy: actor.userId,
      resolvedAt: now,
      updatedAt: now,
    });
    await recordActivity(ctx, {
      orgId,
      actorUserId: actor.userId,
      actorName: actor.userName,
      actorColor: getUserColor(actor.userId),
      entityType: thread.entityType,
      entityId: thread.entityId,
      targetType: thread.targetType,
      targetId: thread.targetId,
      action: "thread_resolved",
      summary: `resolved a discussion${targetLabel(thread.targetType)}`,
      metadata: { threadId },
    });
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
  handler: async (ctx, { orgId, threadId, actorUserId, actorName }) => {
    await assertWritesEnabled(ctx, "collaboration");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, { userId: actorUserId ?? "", userName: actorName ?? "" });
    const thread = await ctx.db.get(threadId as unknown as Id<"commentThreads">);
    if (!thread || thread.orgId !== orgId) throw new ConvexError("Thread not found");
    await ctx.db.patch(thread._id, {
      status: "open",
      resolvedBy: undefined,
      resolvedAt: undefined,
      updatedAt: Date.now(),
    });
    await recordActivity(ctx, {
      orgId,
      actorUserId: actor.userId,
      actorName: actor.userName,
      actorColor: getUserColor(actor.userId),
      entityType: thread.entityType,
      entityId: thread.entityId,
      targetType: thread.targetType,
      targetId: thread.targetId,
      action: "thread_reopened",
      summary: `reopened a discussion${targetLabel(thread.targetType)}`,
      metadata: { threadId },
    });
  },
});

export const listComments = query({
  args: { orgId: v.string(), threadId: v.string() },
  handler: async (ctx, { orgId, threadId }) => {
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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
    await assertWritesEnabled(ctx, "collaboration");
    await enforceBrowserWriteLimit(ctx);
    // A review marker is a lightweight annotation — any org member (no RBAC in the
    // old action; project:read is universal, membership-aware). Service token bypasses.
    await requireOrgPermission(ctx, args.orgId, "project", "read");
    const actor = await resolveActor(ctx, { userId: args.createdBy, userName: args.createdByName });
    const color = getUserColor(actor.userId);
    const now = Date.now();

    const existing = await ctx.db
      .query("reviewMarkers")
      .withIndex("by_orgId_targetId", (q) =>
        q.eq("orgId", args.orgId).eq("targetId", args.targetId)
      )
      .filter((q) => q.eq(q.field("entityId"), args.entityId))
      .first();

    const logMarker = async () => {
      await recordActivity(ctx, {
        orgId: args.orgId,
        actorUserId: actor.userId,
        actorName: actor.userName,
        actorColor: color,
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
        resolvedBy: args.status === "resolved" ? actor.userId : undefined,
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
      createdBy: actor.userId,
      createdByName: actor.userName,
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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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
    await requireOrgReadFor(ctx, orgId, "project"); // Phase 5 domain slice (#1001)
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

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  listThreads: { summary: "List comment threads on a project entity or line item/group target.", danger: "low", mcpTier: 2 },
  listComments: { summary: "List comments in a thread.", danger: "low", mcpTier: 2 },
  getReviewMarker: { summary: "Get the review marker for one target on an entity.", danger: "low", mcpTier: 3 },
  listReviewMarkersForEntity: { summary: "List review markers across an entity's targets.", danger: "low", mcpTier: 3 },
  listActivityEvents: { summary: "List recent collaboration activity events for an entity.", danger: "low", mcpTier: 3 },
  listThreadCommentCounts: { summary: "Open/total/blocking comment counts per target on an entity.", danger: "low", mcpTier: 3 },
  getProjectBlockingSummary: { summary: "Summarise open blocking comment threads on one project.", danger: "low", mcpTier: 2 },
  listBlockingForProjects: { summary: "Open blocking comment counts across many projects.", danger: "low", mcpTier: 3 },
  listOpenBlockingThreads: { summary: "List all open blocking comment threads in the org.", danger: "low", mcpTier: 2 },
};
