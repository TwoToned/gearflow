import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Project (Convex table "projects"). GENERATED — Phase 2.
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
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    clientId: v.optional(v.string()),
    status: v.optional(enums.ProjectStatus),
    type: v.optional(enums.ProjectType),
    description: v.optional(v.string()),
    locationId: v.optional(v.string()),
    siteContactName: v.optional(v.string()),
    siteContactPhone: v.optional(v.string()),
    siteContactEmail: v.optional(v.string()),
    loadInDate: v.optional(v.number()),
    loadInTime: v.optional(v.string()),
    eventStartDate: v.optional(v.number()),
    eventStartTime: v.optional(v.string()),
    eventEndDate: v.optional(v.number()),
    eventEndTime: v.optional(v.string()),
    loadOutDate: v.optional(v.number()),
    loadOutTime: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    defaultRentalPeriod: v.optional(enums.RentalPeriod),
    defaultRentalQuantity: v.optional(v.number()),
    billingMonths: v.optional(v.number()),
    billingWeeks: v.optional(v.number()),
    billingDays: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    equipmentRevenue: v.optional(v.number()),
    serviceCostTotal: v.optional(v.number()),
    labourCostTotal: v.optional(v.number()),
    subHireCostTotal: v.optional(v.number()),
    margin: v.optional(v.number()),
    crewNotes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    clientNotes: v.optional(v.string()),
    subtotal: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    depositPercent: v.optional(v.number()),
    depositPaid: v.optional(v.number()),
    invoicedTotal: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    isTemplate: v.optional(v.boolean()),
    discordChannelId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("projects", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectNumber: v.optional(v.string()),
      name: v.optional(v.string()),
      clientId: v.optional(v.string()),
      status: v.optional(enums.ProjectStatus),
      type: v.optional(enums.ProjectType),
      description: v.optional(v.string()),
      locationId: v.optional(v.string()),
      siteContactName: v.optional(v.string()),
      siteContactPhone: v.optional(v.string()),
      siteContactEmail: v.optional(v.string()),
      loadInDate: v.optional(v.number()),
      loadInTime: v.optional(v.string()),
      eventStartDate: v.optional(v.number()),
      eventStartTime: v.optional(v.string()),
      eventEndDate: v.optional(v.number()),
      eventEndTime: v.optional(v.string()),
      loadOutDate: v.optional(v.number()),
      loadOutTime: v.optional(v.string()),
      rentalStartDate: v.optional(v.number()),
      rentalEndDate: v.optional(v.number()),
      projectManagerId: v.optional(v.string()),
      defaultRentalPeriod: v.optional(enums.RentalPeriod),
      defaultRentalQuantity: v.optional(v.number()),
      billingMonths: v.optional(v.number()),
      billingWeeks: v.optional(v.number()),
      billingDays: v.optional(v.number()),
      taxRate: v.optional(v.number()),
      equipmentRevenue: v.optional(v.number()),
      serviceCostTotal: v.optional(v.number()),
      labourCostTotal: v.optional(v.number()),
      subHireCostTotal: v.optional(v.number()),
      margin: v.optional(v.number()),
      crewNotes: v.optional(v.string()),
      internalNotes: v.optional(v.string()),
      clientNotes: v.optional(v.string()),
      subtotal: v.optional(v.number()),
      discountPercent: v.optional(v.number()),
      discountAmount: v.optional(v.number()),
      taxAmount: v.optional(v.number()),
      total: v.optional(v.number()),
      depositPercent: v.optional(v.number()),
      depositPaid: v.optional(v.number()),
      invoicedTotal: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      isTemplate: v.optional(v.boolean()),
      discordChannelId: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projects not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projects not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
