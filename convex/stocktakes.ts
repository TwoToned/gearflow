import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Stocktake (Convex table "stocktakes"). GENERATED — Phase 2.
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
      .query("stocktakes")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("stocktakes").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    locationId: v.string(),
    scope: enums.StocktakeScope,
    categoryId: v.optional(v.string()),
    status: v.optional(enums.StocktakeStatus),
    startedAt: v.optional(v.number()),
    startedById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    reviewedById: v.optional(v.string()),
    expectedCount: v.optional(v.number()),
    foundCount: v.optional(v.number()),
    missingCount: v.optional(v.number()),
    unexpectedCount: v.optional(v.number()),
    discrepancyCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("stocktakes", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      locationId: v.optional(v.string()),
      scope: v.optional(enums.StocktakeScope),
      categoryId: v.optional(v.string()),
      status: v.optional(enums.StocktakeStatus),
      startedAt: v.optional(v.number()),
      startedById: v.optional(v.string()),
      completedAt: v.optional(v.number()),
      reviewedById: v.optional(v.string()),
      expectedCount: v.optional(v.number()),
      foundCount: v.optional(v.number()),
      missingCount: v.optional(v.number()),
      unexpectedCount: v.optional(v.number()),
      discrepancyCount: v.optional(v.number()),
      notes: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("stocktakes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("stocktakes not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("stocktakes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("stocktakes not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
