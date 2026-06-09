import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for UserNotificationPreference (Convex table "userNotificationPreferences"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    userId: v.string(),
    overdueMaintenance: v.optional(v.boolean()),
    overdueReturn: v.optional(v.boolean()),
    upcomingProject: v.optional(v.boolean()),
    lowStock: v.optional(v.boolean()),
    pendingInvitation: v.optional(v.boolean()),
    expiringCert: v.optional(v.boolean()),
    pendingOffers: v.optional(v.boolean()),
    pendingTimesheets: v.optional(v.boolean()),
    flaggedAsset: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("userNotificationPreferences", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      userId: v.optional(v.string()),
      overdueMaintenance: v.optional(v.boolean()),
      overdueReturn: v.optional(v.boolean()),
      upcomingProject: v.optional(v.boolean()),
      lowStock: v.optional(v.boolean()),
      pendingInvitation: v.optional(v.boolean()),
      expiringCert: v.optional(v.boolean()),
      pendingOffers: v.optional(v.boolean()),
      pendingTimesheets: v.optional(v.boolean()),
      flaggedAsset: v.optional(v.boolean()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("userNotificationPreferences not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("userNotificationPreferences not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
