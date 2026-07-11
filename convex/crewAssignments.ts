import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewAssignment (Convex table "crewAssignments"). GENERATED — Phase 2/5.
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
      .query("crewAssignments")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listByProject = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("crewAssignments")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

/**
 * Look up a single assignment by its (single-use) responseToken. Service-only —
 * used by the public crew-offer respond route (token IS the bearer credential).
 */
export const getByResponseToken = query({
  args: { responseToken: v.string() },
  handler: async (ctx, { responseToken }) => {
    await requireService(ctx);
    return await ctx.db
      .query("crewAssignments")
      .withIndex("by_responseToken", (q) => q.eq("responseToken", responseToken))
      .first();
  },
});

/**
 * All crew assignments for a set of service ids (one round trip), org-scoped.
 * Used to attach assignment summaries onto project services without N+1 reads.
 */
export const listByServiceIds = query({
  args: { serviceIds: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { serviceIds, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const results = [];
    for (const serviceId of serviceIds) {
      const rows = await ctx.db
        .query("crewAssignments")
        .withIndex("by_serviceId", (q) => q.eq("serviceId", serviceId))
        .collect();
      results.push(...rows);
    }
    return results;
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const _id = await ctx.db.insert("crewAssignments", args);
    await bumpCountersForTable(ctx, "crewAssignments", null, args);
    return _id;
  },
});

export const createIfMissing = mutation({
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewAssignments", args);
    await bumpCountersForTable(ctx, "crewAssignments", null, args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAssignments not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    await bumpCountersForTable(ctx, "crewAssignments", doc, { ...doc, ...safePatch });
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAssignments not found: " + id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "crewAssignments", doc, null);
  },
});

// ─── CUSTOM (crew-scheduling write-inversion, Phase C — re-add on a `pnpm convex:crud` regen) ───

const assignmentPatchFields = {
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
  updatedAt: v.optional(v.number()),
};

/**
 * Patch an assignment with explicit field clears. `clear` names are removed
 * (`undefined` in a Convex patch deletes the field) — needed for the status-machine
 * transitions that null `responseToken` (single-use) / `confirmedAt`/`confirmedById`
 * / `crewRoleId`, which the generated `update` can't express (toConvexDoc drops nulls).
 */
export const patchAssignment = mutation({
  args: {
    id: v.string(),
    set: v.object(assignmentPatchFields),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAssignments not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    await bumpCountersForTable(ctx, "crewAssignments", doc, { ...doc, ...patch });
    return doc._id;
  },
});

/** Delete an assignment + its shifts + its (linked) time entries — atomic. Replaces
 *  the dropped Prisma FK cascade. Standalone time entries (no assignmentId) are kept. */
export const deleteCascade = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAssignments not found: " + id);
    const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect();
    for (const s of shifts) await ctx.db.delete(s._id);
    const entries = await ctx.db.query("crewTimeEntries").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect();
    for (const e of entries) await ctx.db.delete(e._id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "crewAssignments", doc, null);
  },
});

// ─── Bulk (multi-select) operations ────────────────────────────────────────
// Collapse an N-assignment bulk action into ONE mutation round-trip: the loop
// runs backend-local instead of one server→Convex call per row. Org-scoped per
// row (by_cuid is global); foreign rows skipped and reported.

/** Bulk cascade-delete N assignments (+ shifts + linked time entries) in one pass. */
export const deleteManyCascade = mutation({
  args: { ids: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { ids, orgId }) => {
    await requireService(ctx);
    const projectIds = new Set<string>();
    let deleted = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect();
      for (const s of shifts) await ctx.db.delete(s._id);
      const entries = await ctx.db.query("crewTimeEntries").withIndex("by_assignmentId", (q) => q.eq("assignmentId", id)).collect();
      for (const e of entries) await ctx.db.delete(e._id);
      await ctx.db.delete(doc._id);
      await bumpCountersForTable(ctx, "crewAssignments", doc, null);
      projectIds.add(doc.projectId);
      deleted++;
    }
    return { deleted, skipped, projectIds: [...projectIds] };
  },
});

/** Bulk status change across N assignments in one pass. Mirrors updateAssignmentStatus'
 *  first-transition CONFIRMED stamp per row. */
export const patchManyStatus = mutation({
  args: {
    ids: v.array(v.string()),
    orgId: v.string(),
    status: enums.AssignmentStatus,
    confirmedById: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { ids, orgId, status, confirmedById, now }) => {
    await requireService(ctx);
    const projectIds = new Set<string>();
    let updated = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("crewAssignments").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      const patch: Record<string, unknown> = { status, updatedAt: now };
      if (status === "CONFIRMED" && !doc.confirmedAt) {
        patch.confirmedAt = now;
        patch.confirmedById = confirmedById;
      }
      await ctx.db.patch(doc._id, patch);
      await bumpCountersForTable(ctx, "crewAssignments", doc, { ...doc, ...patch });
      projectIds.add(doc.projectId);
      updated++;
    }
    return { updated, skipped, projectIds: [...projectIds] };
  },
});

/**
 * Create a service-derived assignment, enforcing the partial-unique invariant
 * `(projectId, crewMemberId, serviceId)` (the Prisma
 * `crew_assignment_project_member_service_key` WHERE serviceId IS NOT NULL).
 * Race-safe: Convex mutations are serializable, so a concurrent insert conflicts on
 * the by_serviceId read range. Returns `{ created, id }` — `created:false` if a row
 * for the same (project, member, service) already exists.
 */
export const createServiceAssignment = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    crewMemberId: v.string(),
    serviceId: v.string(),
    crewRoleId: v.optional(v.string()),
    status: v.optional(enums.AssignmentStatus),
    phase: v.optional(enums.ProjectPhase),
    startDate: v.optional(v.number()),
    startTime: v.optional(v.string()),
    endDate: v.optional(v.number()),
    endTime: v.optional(v.string()),
    rateOverride: v.optional(v.number()),
    rateType: v.optional(enums.CrewRateType),
    estimatedHours: v.optional(v.number()),
    estimatedCost: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const dupe = await ctx.db
      .query("crewAssignments")
      .withIndex("by_serviceId", (q) => q.eq("serviceId", args.serviceId))
      .filter((q) => q.and(q.eq(q.field("projectId"), args.projectId), q.eq(q.field("crewMemberId"), args.crewMemberId)))
      .first();
    if (dupe) return { created: false, id: dupe.id };
    await ctx.db.insert("crewAssignments", args);
    await bumpCountersForTable(ctx, "crewAssignments", null, args);
    return { created: true, id: args.id };
  },
});
