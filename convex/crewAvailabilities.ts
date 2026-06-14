import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewAvailability (Convex table "crewAvailabilities"). GENERATED — Phase 2/5.
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
      .query("crewAvailabilities")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    crewMemberId: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    type: v.optional(enums.AvailabilityType),
    reason: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("crewAvailabilities", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    crewMemberId: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    type: v.optional(enums.AvailabilityType),
    reason: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewAvailabilities", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      crewMemberId: v.optional(v.string()),
      startDate: v.optional(v.number()),
      endDate: v.optional(v.number()),
      type: v.optional(enums.AvailabilityType),
      reason: v.optional(v.string()),
      isAllDay: v.optional(v.boolean()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      organizationId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewAvailabilities not found: " + id);
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
    const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewAvailabilities not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
