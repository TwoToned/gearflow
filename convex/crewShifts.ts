import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewShift (Convex table "crewShifts"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { assignmentId: v.string() },
  handler: async (ctx, { assignmentId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("crewShifts")
      .withIndex("by_assignmentId", (q) => q.eq("assignmentId", assignmentId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * All shifts for an org. crewShift has no org column (it's scoped to its
 * assignment), so join via crewAssignments.by_organizationId.
 * HAND-ADDED for the Phase A crew-dashboard read-rewiring.
 */
export const listByOrg = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    const assignments = await ctx.db
      .query("crewAssignments")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    const out = [];
    for (const a of assignments) {
      const shifts = await ctx.db
        .query("crewShifts")
        .withIndex("by_assignmentId", (q) => q.eq("assignmentId", a.id))
        .collect();
      out.push(...shifts);
    }
    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    assignmentId: v.string(),
    date: v.number(),
    callTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    breakMinutes: v.optional(v.number()),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(enums.ShiftStatus),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("crewShifts", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    assignmentId: v.string(),
    date: v.number(),
    callTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    breakMinutes: v.optional(v.number()),
    location: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(enums.ShiftStatus),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewShifts", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      assignmentId: v.optional(v.string()),
      date: v.optional(v.number()),
      callTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      breakMinutes: v.optional(v.number()),
      location: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: v.optional(enums.ShiftStatus),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewShifts not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewShifts not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
