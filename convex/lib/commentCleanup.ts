import type { MutationCtx } from "../_generated/server";

/**
 * Delete every comment thread (+ its comments) and review marker targeting a given
 * row (e.g. a deleted line item). Without this, a thread's `targetId` outlives the
 * row it was attached to: an `isBlocking:true`/`status:"open"` thread then keeps
 * surfacing in the dashboard's blocking-comments list forever, with no UI left to
 * resolve it from (the target it was anchored to is gone). Called from every route
 * that permanently deletes a line item — R-3.1 single cleanup path, not re-derived
 * per call site.
 */
export async function deleteCommentsAndMarkersForTarget(
  ctx: MutationCtx,
  orgId: string,
  targetId: string,
): Promise<void> {
  const threads = await ctx.db
    .query("commentThreads")
    .withIndex("by_orgId_targetId", (q) => q.eq("orgId", orgId).eq("targetId", targetId))
    .collect();
  for (const thread of threads) {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", thread._id as unknown as string))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);
    await ctx.db.delete(thread._id);
  }

  const markers = await ctx.db
    .query("reviewMarkers")
    .withIndex("by_orgId_targetId", (q) => q.eq("orgId", orgId).eq("targetId", targetId))
    .collect();
  for (const m of markers) await ctx.db.delete(m._id);
}
