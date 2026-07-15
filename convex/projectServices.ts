import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
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
    // by_projectId is a GLOBAL index — filter to the caller's org (cross-tenant guard).
    return (await ctx.db
      .query("projectServices")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()).filter((r) => r.organizationId === orgId);
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
    if (!doc) throw new ConvexError("projectServices not found: " + id);
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
    if (!doc) throw new ConvexError("projectServices not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── CUSTOM (project keystone write-inversion, Phase C) ───

/** Patch a project service with explicit field clears (lineItemId / crewRoleId /
 *  date → unset). The generated `update` can't unset (toConvexDoc drops nulls). */
export const patchService = mutation({
  args: {
    id: v.string(),
    set: v.object({
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
      updatedAt: v.optional(v.number()),
    }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectServices not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

// ─── Bulk (multi-select) operations ────────────────────────────────────────
// One mutation round-trip for an N-service bulk action instead of one
// server→Convex call per row. Org-scoped per row; foreign rows skipped.

/** Bulk status change across N services. */
export const patchManyStatus = mutation({
  args: {
    ids: v.array(v.string()),
    orgId: v.string(),
    status: enums.ServiceStatus,
    now: v.number(),
  },
  handler: async (ctx, { ids, orgId, status, now }) => {
    await requireService(ctx);
    const projectIds = new Set<string>();
    let updated = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      await ctx.db.patch(doc._id, { status, updatedAt: now });
      projectIds.add(doc.projectId);
      updated++;
    }
    return { updated, skipped, projectIds: [...projectIds] };
  },
});

/**
 * Bulk cascade-delete N services in one pass. Mirrors deleteProjectService per
 * row: removes the synthetic line item (+ children + units), the service's crew
 * assignments (+ shifts + linked time entries), then the service itself.
 */
export const removeManyCascade = mutation({
  args: { ids: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { ids, orgId }) => {
    await requireService(ctx);
    const projectIds = new Set<string>();
    let deleted = 0;
    let skipped = 0;
    for (const id of ids) {
      const service = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!service || service.organizationId !== orgId) { skipped++; continue; }

      // Synthetic line item cascade (children + units + the line).
      if (service.lineItemId) {
        const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", service.lineItemId!)).unique();
        if (line) {
          const children = await ctx.db
            .query("projectLineItems")
            .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", line.id))
            .collect();
          for (const c of [...children, line]) {
            const units = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", c.id)).collect();
            for (const u of units) await ctx.db.delete(u._id);
            await ctx.db.delete(c._id);
          }
        }
      }

      // The service's crew assignments (+ shifts + linked time entries).
      const assignments = await ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", id)).collect();
      for (const a of assignments) {
        const shifts = await ctx.db.query("crewShifts").withIndex("by_assignmentId", (q) => q.eq("assignmentId", a.id)).collect();
        for (const s of shifts) await ctx.db.delete(s._id);
        const entries = await ctx.db.query("crewTimeEntries").withIndex("by_assignmentId", (q) => q.eq("assignmentId", a.id)).collect();
        for (const e of entries) await ctx.db.delete(e._id);
        await ctx.db.delete(a._id);
        await bumpCountersForTable(ctx, "crewAssignments", a, null);
      }

      await ctx.db.delete(service._id);
      projectIds.add(service.projectId);
      deleted++;
    }
    return { deleted, skipped, projectIds: [...projectIds] };
  },
});
