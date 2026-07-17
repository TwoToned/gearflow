import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewShift (Convex table "crewShifts"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
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
 * Shifts for a set of assignments (read-rewiring for crew scheduling reads).
 * crewShifts has no organizationId — the org scope is the assignment list the
 * server already fetched (org-scoped via crewAssignments). Service-only, like
 * the other shift reads. One indexed query per assignment id, flattened.
 */
export const listByAssignmentIds = query({
  args: { assignmentIds: v.array(v.string()) },
  handler: async (ctx, { assignmentIds }) => {
    await requireService(ctx);
    const groups = await Promise.all(
      assignmentIds.map((assignmentId) =>
        ctx.db
          .query("crewShifts")
          .withIndex("by_assignmentId", (q) => q.eq("assignmentId", assignmentId))
          .collect(),
      ),
    );
    return groups.flat();
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

// ─── CUSTOM (crew-scheduling write-inversion, Phase C — re-add on a `pnpm convex:crud` regen) ───

/** Patch a shift with explicit field clears (location/notes/callTime/endTime). */
export const patchShift = mutation({
  args: {
    id: v.string(),
    set: v.object({
      date: v.optional(v.number()),
      callTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      breakMinutes: v.optional(v.number()),
      location: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: v.optional(enums.ShiftStatus),
    }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewShifts not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

/** Delete all SCHEDULED shifts for an assignment (generateShifts regen — preserves
 *  non-SCHEDULED shifts), returning the deleted cuids for any external cleanup. */
export const removeScheduledByAssignment = mutation({
  args: { assignmentId: v.string() },
  handler: async (ctx, { assignmentId }) => {
    await requireService(ctx);
    const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", assignmentId)).collect();
    const removed: string[] = [];
    for (const s of shifts) {
      if ((s.status ?? "SCHEDULED") === "SCHEDULED") {
        removed.push(s.id);
        await ctx.db.delete(s._id);
      }
    }
    return removed;
  },
});
