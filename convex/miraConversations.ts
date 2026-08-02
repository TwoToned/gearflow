import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * MiraConversation — one ongoing chat thread per (org, user) (see the table
 * doc comment in convex/schema.ts). SERVICE-only, like miraKeys: this is
 * src/server/mira.ts's own persistence, never something an agent token or a
 * raw Convex client call from the browser should reach directly — the server
 * action already resolved the org/user from the session before calling in.
 */

export const getActiveForUser = query({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    await requireService(ctx);
    const conversations = await ctx.db
      .query("miraConversations")
      .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
      .collect();
    return conversations.find((c) => c.archivedAt == null) ?? null;
  },
});

export const create = mutation({
  args: { id: v.string(), organizationId: v.string(), userId: v.string(), createdAt: v.number() },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const dup = await ctx.db.query("miraConversations").withIndex("by_cuid", (q) => q.eq("id", args.id)).first();
    if (dup) throw new ConvexError("miraConversation id collision: " + args.id);
    await ctx.db.insert("miraConversations", { ...args, updatedAt: args.createdAt });
  },
});

export const touch = mutation({
  args: { id: v.string(), organizationId: v.string() },
  handler: async (ctx, { id, organizationId }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("miraConversations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== organizationId) throw new ConvexError("miraConversation not found: " + id);
    await ctx.db.patch(doc._id, { updatedAt: Date.now() });
  },
});

/** "Clear conversation" — archives rather than deletes, so history is never
 *  silently destroyed (matches the app's soft-delete posture elsewhere). */
export const archive = mutation({
  args: { id: v.string(), organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { id, organizationId, userId }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("miraConversations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== organizationId || doc.userId !== userId) {
      throw new ConvexError("miraConversation not found: " + id);
    }
    await ctx.db.patch(doc._id, { archivedAt: Date.now() });
  },
});
