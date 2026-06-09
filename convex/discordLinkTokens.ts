import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for DiscordLinkToken (Convex table "discordLinkTokens"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("discordLinkTokens")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("discordLinkTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    crewMemberId: v.string(),
    tokenHash: v.string(),
    discordUserId: v.string(),
    guildId: v.optional(v.string()),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("discordLinkTokens", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      crewMemberId: v.optional(v.string()),
      tokenHash: v.optional(v.string()),
      discordUserId: v.optional(v.string()),
      guildId: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      consumedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("discordLinkTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("discordLinkTokens not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("discordLinkTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("discordLinkTokens not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
