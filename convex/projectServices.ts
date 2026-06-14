import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for ProjectService (Convex table "projectServices"). GENERATED — Phase 2/5.
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
      .query("projectServices")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listByProject = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("projectServices")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    type: enums.ServiceType,
    title: v.string(),
    description: v.optional(v.string()),
    notes: v.optional(v.string()),
    date: v.optional(v.number()),
    endDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    scheduledTime: v.optional(v.string()),
    estimatedDuration: v.optional(v.number()),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    status: v.optional(enums.ServiceStatus),
    showOnDocuments: v.optional(v.boolean()),
    billableToClient: v.optional(v.boolean()),
    unitPrice: v.optional(v.number()),
    quantity: v.optional(v.number()),
    pricingType: v.optional(enums.PricingType),
    duration: v.optional(v.number()),
    discount: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    costTotal: v.optional(v.number()),
    taxable: v.optional(v.boolean()),
    lineItemId: v.optional(v.string()),
    vehicleDescription: v.optional(v.string()),
    numberOfTrips: v.optional(v.number()),
    crewCountRequired: v.optional(v.number()),
    crewRoleId: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectServices", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    type: enums.ServiceType,
    title: v.string(),
    description: v.optional(v.string()),
    notes: v.optional(v.string()),
    date: v.optional(v.number()),
    endDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    scheduledTime: v.optional(v.string()),
    estimatedDuration: v.optional(v.number()),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    status: v.optional(enums.ServiceStatus),
    showOnDocuments: v.optional(v.boolean()),
    billableToClient: v.optional(v.boolean()),
    unitPrice: v.optional(v.number()),
    quantity: v.optional(v.number()),
    pricingType: v.optional(enums.PricingType),
    duration: v.optional(v.number()),
    discount: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    costTotal: v.optional(v.number()),
    taxable: v.optional(v.boolean()),
    lineItemId: v.optional(v.string()),
    vehicleDescription: v.optional(v.string()),
    numberOfTrips: v.optional(v.number()),
    crewCountRequired: v.optional(v.number()),
    crewRoleId: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectServices", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      type: v.optional(enums.ServiceType),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      notes: v.optional(v.string()),
      date: v.optional(v.number()),
      endDate: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      scheduledTime: v.optional(v.string()),
      estimatedDuration: v.optional(v.number()),
      address: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      status: v.optional(enums.ServiceStatus),
      showOnDocuments: v.optional(v.boolean()),
      billableToClient: v.optional(v.boolean()),
      unitPrice: v.optional(v.number()),
      quantity: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      duration: v.optional(v.number()),
      discount: v.optional(v.number()),
      lineTotal: v.optional(v.number()),
      costTotal: v.optional(v.number()),
      taxable: v.optional(v.boolean()),
      lineItemId: v.optional(v.string()),
      vehicleDescription: v.optional(v.string()),
      numberOfTrips: v.optional(v.number()),
      crewCountRequired: v.optional(v.number()),
      crewRoleId: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projectServices not found: " + id);
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
    const doc = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projectServices not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
