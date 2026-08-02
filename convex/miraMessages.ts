import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * MiraMessage — one turn in a miraConversations thread (see the table doc
 * comment in convex/schema.ts). SERVICE-only, same posture as
 * miraConversations/miraKeys — src/server/mira.ts's own persistence.
 */

export const listForConversation = query({
  args: { conversationId: v.string(), organizationId: v.string() },
  handler: async (ctx, { conversationId, organizationId }) => {
    await requireService(ctx);
    // A "Clear conversation" archive caps how long any one thread can grow —
    // bounded by how much one person chats with Mira before starting fresh.
    // A capped take, not a full-table read — outside R-9.8's scope either way.
    const rows = await ctx.db
      .query("miraMessages")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
      .take(500);
    return rows.filter((r) => r.organizationId === organizationId);
  },
});

export const getById = query({
  args: { id: v.string(), organizationId: v.string() },
  handler: async (ctx, { id, organizationId }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("miraMessages").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== organizationId) return null;
    return doc;
  },
});

export const append = mutation({
  args: {
    id: v.string(),
    conversationId: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("tool")),
    content: v.union(v.string(), v.null()),
    toolCalls: v.optional(v.any()),
    toolCallId: v.optional(v.string()),
    toolName: v.optional(v.string()),
    pendingConfirmation: v.optional(
      v.union(
        v.null(),
        v.object({
          operation: v.string(),
          args: v.any(),
          idempotencyKey: v.string(),
          summary: v.string(),
        }),
      ),
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const dup = await ctx.db.query("miraMessages").withIndex("by_cuid", (q) => q.eq("id", args.id)).first();
    if (dup) throw new ConvexError("miraMessage id collision: " + args.id);
    await ctx.db.insert("miraMessages", args);
  },
});

/** Clear a pending confirmation off a message — either it was just resolved
 *  (confirmed and executed) or the user dismissed it without acting. */
export const clearPendingConfirmation = mutation({
  args: { id: v.string(), organizationId: v.string() },
  handler: async (ctx, { id, organizationId }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("miraMessages").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== organizationId) throw new ConvexError("miraMessage not found: " + id);
    await ctx.db.patch(doc._id, { pendingConfirmation: undefined });
  },
});
