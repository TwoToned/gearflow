import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for StocktakeItem (Convex table "stocktakeItems"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { stocktakeId: v.string() },
  handler: async (ctx, { stocktakeId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("stocktakeItems")
      .withIndex("by_stocktakeId", (q) => q.eq("stocktakeId", stocktakeId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("stocktakeItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("stocktakeItems", args);
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("stocktakeItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("stocktakeItems not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("stocktakeItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("stocktakeItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
