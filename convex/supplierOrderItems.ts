import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for SupplierOrderItem (Convex table "supplierOrderItems"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) =>
    await ctx.db
      .query("supplierOrderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    orderId: v.string(),
    description: v.string(),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    modelId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    notes: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("supplierOrderItems", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      orderId: v.optional(v.string()),
      description: v.optional(v.string()),
      quantity: v.optional(v.number()),
      unitPrice: v.optional(v.number()),
      lineTotal: v.optional(v.number()),
      modelId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      notes: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("supplierOrderItems not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("supplierOrderItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
