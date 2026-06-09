import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Client (Convex table "clients"). GENERATED — Phase 2.
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
      .query("clients")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    type: v.optional(enums.ClientType),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    billingLatitude: v.optional(v.number()),
    billingLongitude: v.optional(v.number()),
    shippingAddress: v.optional(v.string()),
    shippingLatitude: v.optional(v.number()),
    shippingLongitude: v.optional(v.number()),
    taxId: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultDiscount: v.optional(v.number()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("clients", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      type: v.optional(enums.ClientType),
      contactName: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      billingAddress: v.optional(v.string()),
      billingLatitude: v.optional(v.number()),
      billingLongitude: v.optional(v.number()),
      shippingAddress: v.optional(v.string()),
      shippingLatitude: v.optional(v.number()),
      shippingLongitude: v.optional(v.number()),
      taxId: v.optional(v.string()),
      paymentTerms: v.optional(v.string()),
      defaultDiscount: v.optional(v.number()),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("clients not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("clients not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
