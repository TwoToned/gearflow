import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for SubHire (Convex table "subHires"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("subHires")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listByProject = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("subHires")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("subHires", args);
  },
});

export const createIfMissing = mutation({
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("subHires", args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("subHires not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("subHires not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
