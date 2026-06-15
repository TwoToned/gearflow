import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for UserNotificationPreference (Convex table "userNotificationPreferences"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("userNotificationPreferences", args);
  },
});

export const createIfMissing = mutation({
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("userNotificationPreferences", args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("userNotificationPreferences not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("userNotificationPreferences not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
