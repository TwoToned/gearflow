import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for ServiceTemplate (Convex table "serviceTemplates"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("serviceTemplates")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    type: enums.ServiceType,
    title: v.string(),
    description: v.optional(v.string()),
    defaultCrewCount: v.optional(v.number()),
    defaultVehicle: v.optional(v.string()),
    defaultPricingType: v.optional(enums.PricingType),
    defaultUnitPrice: v.optional(v.number()),
    showOnDocuments: v.optional(v.boolean()),
    isAutoAdded: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("serviceTemplates", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    type: enums.ServiceType,
    title: v.string(),
    description: v.optional(v.string()),
    defaultCrewCount: v.optional(v.number()),
    defaultVehicle: v.optional(v.string()),
    defaultPricingType: v.optional(enums.PricingType),
    defaultUnitPrice: v.optional(v.number()),
    showOnDocuments: v.optional(v.boolean()),
    isAutoAdded: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("serviceTemplates", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      type: v.optional(enums.ServiceType),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      defaultCrewCount: v.optional(v.number()),
      defaultVehicle: v.optional(v.string()),
      defaultPricingType: v.optional(enums.PricingType),
      defaultUnitPrice: v.optional(v.number()),
      showOnDocuments: v.optional(v.boolean()),
      isAutoAdded: v.optional(v.boolean()),
      sortOrder: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("serviceTemplates not found: " + id);
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
    const doc = await ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("serviceTemplates not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
