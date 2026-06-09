import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for DiscordOutbox (Convex table "discordOutboxes"). GENERATED — Phase 2.
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
      .query("discordOutboxes")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.number() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("discordOutboxes").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.number(),
    organizationId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    dedupeKey: v.string(),
    status: v.optional(enums.DiscordOutboxStatus),
    attemptCount: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lockedAt: v.optional(v.number()),
    processedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("discordOutboxes", args),
});

export const update = mutation({
  args: {
    id: v.number(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      eventType: v.optional(v.string()),
      payload: v.optional(v.any()),
      dedupeKey: v.optional(v.string()),
      status: v.optional(enums.DiscordOutboxStatus),
      attemptCount: v.optional(v.number()),
      nextAttemptAt: v.optional(v.number()),
      lockedAt: v.optional(v.number()),
      processedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("discordOutboxes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("discordOutboxes not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.number() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("discordOutboxes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("discordOutboxes not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
