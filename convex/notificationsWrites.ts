import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { assertStrLen } from "./lib/fieldGuards";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Browser-direct USER-scoped notification writes (work-layer phase 0, #1241,
 * work-layer.md §10.2). Same posture as notificationDismissalsWrites.ts: a
 * notification row is owned by the (organizationId, userId) baked into the
 * VERIFIED token, so every write here re-checks the loaded row against BOTH
 * before touching it — a member can only ever mark or archive their OWN
 * notifications in THEIR active org, never one addressed to someone else even
 * if they can guess its id.
 *
 * There is no "create" mutation here on purpose — the only writer is
 * convex/lib/notify.ts, called in-band from the mutation that causes the event
 * (the comment mutations in convex/collaboration.ts), never a standalone call a
 * browser or agent could invoke directly.
 */

async function loadOwnNotification(
  ctx: MutationCtx,
  id: string,
  organizationId: string,
  userId: string,
) {
  const doc = await ctx.db.query("notifications").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!doc || doc.organizationId !== organizationId || doc.userId !== userId) {
    throw new ConvexError("Notification not found.");
  }
  return doc;
}

/** Mark one of the caller's own notifications read. Idempotent — marking an
 *  already-read row again just re-stamps readAt (same observable state). */
export const markReadNative = mutation({
  returns: v.null(),
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await assertWritesEnabled(ctx, "notifications");
    await enforceBrowserWriteLimit(ctx);
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: a signed-in user is required.");
    if (!auth.orgId) throw new ConvexError("Forbidden: no active organization.");
    await requireSelfScope(ctx, "write");
    const doc = await loadOwnNotification(ctx, id, auth.orgId, auth.userId);
    if (!doc.readAt) await ctx.db.patch(doc._id, { readAt: Date.now() });
    return null;
  },
});

/** Mark every unread notification the caller has in their active org read, in
 *  one call. Idempotent — a second call with nothing unread is a no-op. */
export const markAllReadNative = mutation({
  returns: v.object({ marked: v.number() }),
  args: {},
  handler: async (ctx) => {
    await assertWritesEnabled(ctx, "notifications");
    await enforceBrowserWriteLimit(ctx);
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: a signed-in user is required.");
    if (!auth.orgId) throw new ConvexError("Forbidden: no active organization.");
    await requireSelfScope(ctx, "write");
    const orgId = auth.orgId;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_organizationId_userId_readAt", (q) =>
        q.eq("organizationId", orgId).eq("userId", auth.userId).eq("readAt", undefined),
      )
      .collect();
    const now = Date.now();
    for (const row of rows) await ctx.db.patch(row._id, { readAt: now });
    return { marked: rows.length };
  },
});

/** Archive one of the caller's own notifications (removes it from the bell
 *  feed; does not delete the row). */
export const archiveNative = mutation({
  returns: v.null(),
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await assertWritesEnabled(ctx, "notifications");
    await enforceBrowserWriteLimit(ctx);
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: a signed-in user is required.");
    if (!auth.orgId) throw new ConvexError("Forbidden: no active organization.");
    await requireSelfScope(ctx, "write");
    const doc = await loadOwnNotification(ctx, id, auth.orgId, auth.userId);
    if (!doc.archivedAt) await ctx.db.patch(doc._id, { archivedAt: Date.now() });
    return null;
  },
});

/**
 * The reverse of `markAllReadNative` — powers the bell's `Mark all read` Undo
 * (the shell's ONE reverse trigger, UX unification D70 / 6a). Takes the EXACT ids
 * the forward call marked (the client holds them) so Undo never un-reads a row
 * the user had already read before. Same posture as the rest of this module: every
 * id is re-checked against the verified (organizationId, userId), so an id that
 * isn't the caller's own in their active org is rejected like a missing row, and
 * the batch is capped by the identity-derived bulk cap. Idempotent (an already
 * unread row is left alone).
 */
export const markUnreadManyNative = mutation({
  returns: v.object({ marked: v.number() }),
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    await assertWritesEnabled(ctx, "notifications");
    await enforceBrowserWriteLimit(ctx);
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: a signed-in user is required.");
    if (!auth.orgId) throw new ConvexError("Forbidden: no active organization.");
    await requireSelfScope(ctx, "write");
    await assertBulkSizeOk(ctx, ids.length);
    for (const id of ids) assertStrLen(id, "id", { min: 1, max: 128 });
    let marked = 0;
    for (const id of new Set(ids)) {
      const doc = await loadOwnNotification(ctx, id, auth.orgId, auth.userId);
      if (doc.readAt) {
        await ctx.db.patch(doc._id, { readAt: undefined });
        marked++;
      }
    }
    return { marked };
  },
});

/**
 * Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9).
 * Personal-scope (self:write) inbox bookkeeping — no domain effect.
 */
export const agentOps: AgentOpsAnnotations = {
  markUnreadManyNative: { danger: "low" },
  markReadNative: { danger: "low" },
  markAllReadNative: { danger: "low" },
  archiveNative: { danger: "low" },
};
