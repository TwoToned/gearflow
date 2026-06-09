import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for WarehouseDashboardToken (Convex table "warehouseDashboardTokens"). GENERATED — Phase 2.
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
      .query("warehouseDashboardTokens")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("warehouseDashboardTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    locationId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    layout: v.optional(v.string()),
    createdById: v.string(),
    lastAccessedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("warehouseDashboardTokens", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      token: v.optional(v.string()),
      tokenHash: v.optional(v.string()),
      locationId: v.optional(v.string()),
      isActive: v.optional(v.boolean()),
      layout: v.optional(v.string()),
      createdById: v.optional(v.string()),
      lastAccessedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("warehouseDashboardTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("warehouseDashboardTokens not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("warehouseDashboardTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("warehouseDashboardTokens not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
