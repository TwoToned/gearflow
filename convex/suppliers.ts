import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for Supplier (Convex table "suppliers"). GENERATED — Phase 2.
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
      .query("suppliers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    notes: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultLeadTime: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("suppliers", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      address: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      notes: v.optional(v.string()),
      accountNumber: v.optional(v.string()),
      paymentTerms: v.optional(v.string()),
      defaultLeadTime: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("suppliers not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("suppliers not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
