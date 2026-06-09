import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for SubHireGroup (Convex table "subHireGroups"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { subHireId: v.string() },
  handler: async (ctx, { subHireId }) =>
    await ctx.db
      .query("subHireGroups")
      .withIndex("by_subHireId", (q) => q.eq("subHireId", subHireId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    subHireId: v.string(),
    title: v.string(),
    sortOrder: v.optional(v.number()),
    quantity: v.optional(v.number()),
    cost: v.optional(v.number()),
    charge: v.optional(v.number()),
    showOnQuote: v.optional(v.boolean()),
    showOnDocs: v.optional(v.boolean()),
    targetCategoryId: v.optional(v.string()),
    targetGroupId: v.optional(v.string()),
  },
  handler: async (ctx, args) => await ctx.db.insert("subHireGroups", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      subHireId: v.optional(v.string()),
      title: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      quantity: v.optional(v.number()),
      cost: v.optional(v.number()),
      charge: v.optional(v.number()),
      showOnQuote: v.optional(v.boolean()),
      showOnDocs: v.optional(v.boolean()),
      targetCategoryId: v.optional(v.string()),
      targetGroupId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("subHireGroups not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("subHireGroups not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
