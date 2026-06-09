import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewAssignment (Convex table "crewAssignments"). GENERATED — Phase 2.
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
      .query("crewAssignments")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    crewMemberId: v.string(),
    crewRoleId: v.optional(v.string()),
    status: v.optional(enums.AssignmentStatus),
    phase: v.optional(enums.ProjectPhase),
    isProjectManager: v.optional(v.boolean()),
    startDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endDate: v.optional(v.number()),
    endTime: v.optional(v.string()),
    rateOverride: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    estimatedHours: v.optional(v.number()),
    estimatedCost: v.optional(v.number()),
    notes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    responseToken: v.optional(v.string()),
    offeredAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    responseNote: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    confirmedById: v.optional(v.string()),
    serviceId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("crewAssignments", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      crewMemberId: v.optional(v.string()),
      crewRoleId: v.optional(v.string()),
      status: v.optional(enums.AssignmentStatus),
      phase: v.optional(enums.ProjectPhase),
      isProjectManager: v.optional(v.boolean()),
      startDate: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endDate: v.optional(v.number()),
      endTime: v.optional(v.string()),
      rateOverride: v.optional(v.number()),
      rateType: v.optional(enums.CrewRateType),
      estimatedHours: v.optional(v.number()),
      estimatedCost: v.optional(v.number()),
      notes: v.optional(v.string()),
      internalNotes: v.optional(v.string()),
      responseToken: v.optional(v.string()),
      offeredAt: v.optional(v.number()),
      respondedAt: v.optional(v.number()),
      responseNote: v.optional(v.string()),
      confirmedAt: v.optional(v.number()),
      confirmedById: v.optional(v.string()),
      serviceId: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewAssignments not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewAssignments not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
