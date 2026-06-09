import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for StocktakeItem (Convex table "stocktakeItems"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { stocktakeId: v.string() },
  handler: async (ctx, { stocktakeId }) =>
    await ctx.db
      .query("stocktakeItems")
      .withIndex("by_stocktakeId", (q) => q.eq("stocktakeId", stocktakeId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("stocktakeItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    stocktakeId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    expectedAtLocation: v.optional(v.boolean()),
    expectedQuantity: v.optional(v.number()),
    found: v.optional(v.boolean()),
    foundQuantity: v.optional(v.number()),
    scannedAt: v.optional(v.number()),
    scannedById: v.optional(v.string()),
    result: v.optional(enums.StocktakeItemResult),
    conditionNote: v.optional(v.string()),
    actionTaken: v.optional(v.string()),
  },
  handler: async (ctx, args) => await ctx.db.insert("stocktakeItems", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      stocktakeId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      expectedAtLocation: v.optional(v.boolean()),
      expectedQuantity: v.optional(v.number()),
      found: v.optional(v.boolean()),
      foundQuantity: v.optional(v.number()),
      scannedAt: v.optional(v.number()),
      scannedById: v.optional(v.string()),
      result: v.optional(enums.StocktakeItemResult),
      conditionNote: v.optional(v.string()),
      actionTaken: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("stocktakeItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("stocktakeItems not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("stocktakeItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("stocktakeItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
