import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for ProjectService (Convex table "projectServices"). GENERATED — Phase 2.
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
      .query("projectServices")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
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
  handler: async (ctx, args) => await ctx.db.insert("projectServices", args),
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
    const doc = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projectServices not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projectServices not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
