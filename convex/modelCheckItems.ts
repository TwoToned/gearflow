import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for ModelCheckItem (Convex table "modelCheckItems"). GENERATED — Phase 2.
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
      .query("modelCheckItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("modelCheckItems", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      checkItemId: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("modelCheckItems not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("modelCheckItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
