import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import type { Doc } from "./_generated/dataModel";

/**
 * Browser-direct USER-scoped reads for the mentions inbox (work-layer phase 0,
 * #1241, work-layer.md §10.2). Notifications are PER-USER-WITHIN-ORG — there is
 * no org-row to authorize with a resource permission, so security hinges on
 * deriving BOTH organizationId and userId from the VERIFIED token
 * (getAuthContext), never a client arg, the same posture as
 * notificationDismissalsWrites.ts. Users are multi-org, so every index is
 * org-prefixed (R-8.4.3) — a member in two orgs only ever sees the active org's
 * rows.
 *
 * Writes (markRead / markAllRead / archive) live in notificationsWrites.ts. The
 * INSERT path lives in convex/lib/notify.ts, called in-band from the comment
 * mutations in convex/collaboration.ts — there is no public "create" mutation
 * here, so an event can only ever originate from the transaction that caused it.
 */

/**
 * The verified caller's most recent, non-archived notifications in their active
 * org (bell feed). Reactive — a mention/read/archive write updates this live,
 * with no manual refetch. Returns [] for an unauthenticated / org-less caller.
 */
export const listForMe = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<Doc<"notifications">[]> => {
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth) || !auth.orgId) return [];
    await requireSelfScope(ctx, "read");
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_organizationId_userId_createdAt", (q) =>
        q.eq("organizationId", auth.orgId as string).eq("userId", auth.userId),
      )
      .order("desc")
      .take(Math.min(limit ?? 20, 100));
    return rows.filter((r) => !r.archivedAt);
  },
});

/**
 * Unread count for the verified caller in their active org — a plain indexed
 * query on `by_organizationId_userId_readAt` (readAt undefined = unread). NOT a
 * sharded counter: that component exists for hot-row write contention on shared
 * org-wide counters, and a per-user unread count is neither hot nor shared
 * (work-layer.md §10.2).
 */
export const unreadCountForMe = query({
  returns: v.number(),
  args: {},
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth) || !auth.orgId) return 0;
    await requireSelfScope(ctx, "read");
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_organizationId_userId_readAt", (q) =>
        q.eq("organizationId", auth.orgId as string).eq("userId", auth.userId).eq("readAt", undefined),
      )
      .collect();
    return rows.filter((r) => !r.archivedAt).length;
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForMe: { summary: "List the caller's recent, non-archived notifications in their active org.", danger: "low", mcpTier: 2 },
  unreadCountForMe: { summary: "Count the caller's unread notifications in their active org.", danger: "low", mcpTier: 3 },
};
