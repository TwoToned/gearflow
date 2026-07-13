import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewTimeEntry (Convex table "crewTimeEntries"). GENERATED — Phase 2/5.
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
      .query("crewTimeEntries")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assignmentId: v.optional(v.string()),
    crewMemberId: v.string(),
    description: v.optional(v.string()),
    date: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    breakMinutes: v.optional(v.number()),
    totalHours: v.optional(v.number()),
    status: v.optional(enums.TimeEntryStatus),
    approvedById: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("crewTimeEntries", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assignmentId: v.optional(v.string()),
    crewMemberId: v.string(),
    description: v.optional(v.string()),
    date: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    breakMinutes: v.optional(v.number()),
    totalHours: v.optional(v.number()),
    status: v.optional(enums.TimeEntryStatus),
    approvedById: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewTimeEntries", args);
    return { _id, created: true };
  },
});

/**
 * Insert many time entries in ONE atomic mutation — collapses the "log time for
 * N selected crew" client loop (one createTimeEntry round-trip per crew member).
 * createIfMissing semantics per entry (idempotent by cuid on retry). The server
 * action validates each crew member + assignment before calling this, so every
 * entry here is already vetted.
 */
export const createMany = mutation({
  args: {
    entries: v.array(
      v.object({
        id: v.string(),
        organizationId: v.string(),
        assignmentId: v.optional(v.string()),
        crewMemberId: v.string(),
        description: v.optional(v.string()),
        date: v.number(),
        startTime: v.string(),
        endTime: v.string(),
        breakMinutes: v.optional(v.number()),
        totalHours: v.optional(v.number()),
        status: v.optional(enums.TimeEntryStatus),
        notes: v.optional(v.string()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    await requireService(ctx);
    for (const e of entries) {
      const existing = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", e.id)).unique();
      if (existing) continue;
      await ctx.db.insert("crewTimeEntries", e);
    }
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      assignmentId: v.optional(v.string()),
      crewMemberId: v.optional(v.string()),
      description: v.optional(v.string()),
      date: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      breakMinutes: v.optional(v.number()),
      totalHours: v.optional(v.number()),
      status: v.optional(enums.TimeEntryStatus),
      approvedById: v.optional(v.string()),
      approvedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewTimeEntries not found: " + id);
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
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewTimeEntries not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Bulk status transition (bulk single-call invariant, Phase 3): apply ONE shared `set`
 * to N time entries in a single array mutation — replaces the server firing one
 * `patchTimeEntry` round-trip per entry (submit / approve N timesheets). Guards each
 * entry per-item: `organizationId` re-check (by_cuid is a GLOBAL index) + a
 * `fromStatuses` eligibility gate re-checked HERE (TOCTOU-safe — the status may have
 * changed since the caller read it). Skips ineligible entries; returns the ids updated.
 */
export const patchManyStatus = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.string()),
    fromStatuses: v.array(enums.TimeEntryStatus),
    set: v.object({
      status: enums.TimeEntryStatus,
      approvedById: v.optional(v.string()),
      approvedAt: v.optional(v.number()),
      updatedAt: v.number(),
    }),
  },
  handler: async (ctx, { organizationId, ids, fromStatuses, set }) => {
    await requireService(ctx);
    const allowed = new Set<string>(fromStatuses);
    const updated: string[] = [];
    for (const id of ids) {
      const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue; // per-item org re-check
      if (doc.status == null || !allowed.has(doc.status)) continue; // eligibility (status may have changed)
      await ctx.db.patch(doc._id, set);
      updated.push(id);
    }
    return { count: updated.length, updated };
  },
});

// ─── CUSTOM (crew-scheduling write-inversion, Phase C — re-add on a `pnpm convex:crud` regen) ───

/** Patch a time entry with explicit field clears — the edit-resets-to-DRAFT path
 *  clears `approvedById`/`approvedAt`, which the generated `update` can't express. */
export const patchTimeEntry = mutation({
  args: {
    id: v.string(),
    set: v.object({
      assignmentId: v.optional(v.string()),
      description: v.optional(v.string()),
      date: v.optional(v.number()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      breakMinutes: v.optional(v.number()),
      totalHours: v.optional(v.number()),
      status: v.optional(enums.TimeEntryStatus),
      approvedById: v.optional(v.string()),
      approvedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewTimeEntries").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewTimeEntries not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});
