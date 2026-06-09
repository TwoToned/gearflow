import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for SubHire (Convex table "subHires"). GENERATED — Phase 2.
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
      .query("subHires")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    projectId: v.optional(v.string()),
    createdById: v.string(),
    orderNumber: v.string(),
    supplierReference: v.optional(v.string()),
    status: v.optional(enums.SubHireStatus),
    hireStart: v.optional(v.number()),
    hireEnd: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    totalCharge: v.optional(v.number()),
    pricingMode: v.optional(enums.SubHirePricingMode),
    orderTotalCost: v.optional(v.number()),
    orderTotalCharge: v.optional(v.number()),
    showOnDocs: v.optional(v.boolean()),
    paymentStatus: v.optional(enums.SubHirePaymentStatus),
    notes: v.optional(v.string()),
    defaultTargetCategoryId: v.optional(v.string()),
    defaultTargetGroupId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("subHires", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      createdById: v.optional(v.string()),
      orderNumber: v.optional(v.string()),
      supplierReference: v.optional(v.string()),
      status: v.optional(enums.SubHireStatus),
      hireStart: v.optional(v.number()),
      hireEnd: v.optional(v.number()),
      totalCost: v.optional(v.number()),
      totalCharge: v.optional(v.number()),
      pricingMode: v.optional(enums.SubHirePricingMode),
      orderTotalCost: v.optional(v.number()),
      orderTotalCharge: v.optional(v.number()),
      showOnDocs: v.optional(v.boolean()),
      paymentStatus: v.optional(enums.SubHirePaymentStatus),
      notes: v.optional(v.string()),
      defaultTargetCategoryId: v.optional(v.string()),
      defaultTargetGroupId: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("subHires not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("subHires not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
