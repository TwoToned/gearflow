import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireService } from "./lib/auth";
import { deleteCommentsAndMarkersForTarget } from "./lib/commentCleanup";

/**
 * One-time cleanup for the "deleted line item leaves its comments behind" bug
 * fixed by `deleteCommentsAndMarkersForTarget` (see convex/lineItemWrites.ts /
 * convex/projectLineItems.ts). That fix only stops NEW orphans from being
 * created — a `commentThreads`/`reviewMarkers` row whose `targetId` pointed at a
 * line item deleted BEFORE the fix shipped is still sitting there. An
 * `isBlocking:true`/`status:"open"` orphan of that kind keeps surfacing in
 * `dashboardLists.blocking` forever, with nothing left to resolve it from.
 *
 * Two independent paginated passes (commentThreads, reviewMarkers — different
 * tables, different cursors), same shape as the other `backfill*.ts` migrations
 * in this repo (dry-run by default via `apply: false`, a companion `verify*`
 * query to prove zero orphans remain). Both passes call the SAME
 * `deleteCommentsAndMarkersForTarget` the live delete paths use, so a thread and
 * any marker sharing its targetId are cleaned together the first time either
 * table's pass reaches them — the second pass is then a no-op for that id
 * (idempotent, safe to re-run).
 *
 * SERVICE-only. Driver: scripts/convex-backfill-orphaned-line-item-comments.ts.
 */

async function lineItemExists(ctx: QueryCtx | MutationCtx, orgId: string, targetId: string): Promise<boolean> {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", targetId)).first();
  return line != null && line.organizationId === orgId;
}

export const backfillOrphanedCommentThreadsPage = mutation({
  args: { cursor: v.union(v.string(), v.null()), apply: v.boolean(), numItems: v.optional(v.number()) },
  returns: v.object({ scanned: v.number(), orphaned: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("commentThreads").paginate({ cursor, numItems: numItems ?? 300 });
    let orphaned = 0;
    for (const thread of res.page) {
      if (thread.targetType !== "lineItem" || !thread.targetId) continue;
      if (await lineItemExists(ctx, thread.orgId, thread.targetId)) continue;
      orphaned++;
      if (apply) await deleteCommentsAndMarkersForTarget(ctx, thread.orgId, thread.targetId);
    }
    return { scanned: res.page.length, orphaned, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const verifyOrphanedCommentThreads = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  returns: v.object({ orphaned: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("commentThreads").paginate({ cursor, numItems: numItems ?? 300 });
    let orphaned = 0;
    for (const thread of res.page) {
      if (thread.targetType !== "lineItem" || !thread.targetId) continue;
      if (!(await lineItemExists(ctx, thread.orgId, thread.targetId))) orphaned++;
    }
    return { orphaned, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const backfillOrphanedReviewMarkersPage = mutation({
  args: { cursor: v.union(v.string(), v.null()), apply: v.boolean(), numItems: v.optional(v.number()) },
  returns: v.object({ scanned: v.number(), orphaned: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("reviewMarkers").paginate({ cursor, numItems: numItems ?? 300 });
    let orphaned = 0;
    for (const marker of res.page) {
      if (marker.targetType !== "lineItem" || !marker.targetId) continue;
      if (await lineItemExists(ctx, marker.orgId, marker.targetId)) continue;
      orphaned++;
      // Idempotent with the threads pass above — a no-op if that pass already
      // deleted this same targetId's marker(s) alongside its thread.
      if (apply) await deleteCommentsAndMarkersForTarget(ctx, marker.orgId, marker.targetId);
    }
    return { scanned: res.page.length, orphaned, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const verifyOrphanedReviewMarkers = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  returns: v.object({ orphaned: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("reviewMarkers").paginate({ cursor, numItems: numItems ?? 300 });
    let orphaned = 0;
    for (const marker of res.page) {
      if (marker.targetType !== "lineItem" || !marker.targetId) continue;
      if (!(await lineItemExists(ctx, marker.orgId, marker.targetId))) orphaned++;
    }
    return { orphaned, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
