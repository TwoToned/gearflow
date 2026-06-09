import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for SupplierOrderItem (Convex table "supplierOrderItems"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (no browser subscriber yet). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("supplierOrderItems")
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("supplierOrderItems", args);
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("supplierOrderItems not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("supplierOrderItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("supplierOrderItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
