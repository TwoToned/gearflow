import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for MaintenanceRecord (Convex table "maintenanceRecords"). GENERATED — Phase 2/5.
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
      .query("maintenanceRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    type: enums.MaintenanceType,
    status: v.optional(enums.MaintenanceStatus),
    title: v.string(),
    description: v.optional(v.string()),
    reportedById: v.optional(v.string()),
    assignedToId: v.optional(v.string()),
    scheduledDate: v.optional(v.number()),
    completedDate: v.optional(v.number()),
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.string()),
    attachments: v.optional(v.array(v.string())),
    photos: v.optional(v.array(v.string())),
    result: v.optional(enums.MaintenanceResult),
    nextDueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("maintenanceRecords", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    type: enums.MaintenanceType,
    status: v.optional(enums.MaintenanceStatus),
    title: v.string(),
    description: v.optional(v.string()),
    reportedById: v.optional(v.string()),
    assignedToId: v.optional(v.string()),
    scheduledDate: v.optional(v.number()),
    completedDate: v.optional(v.number()),
    cost: v.optional(v.number()),
    partsUsed: v.optional(v.string()),
    attachments: v.optional(v.array(v.string())),
    photos: v.optional(v.array(v.string())),
    result: v.optional(enums.MaintenanceResult),
    nextDueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("maintenanceRecords", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      type: v.optional(enums.MaintenanceType),
      status: v.optional(enums.MaintenanceStatus),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      reportedById: v.optional(v.string()),
      assignedToId: v.optional(v.string()),
      scheduledDate: v.optional(v.number()),
      completedDate: v.optional(v.number()),
      cost: v.optional(v.number()),
      partsUsed: v.optional(v.string()),
      attachments: v.optional(v.array(v.string())),
      photos: v.optional(v.array(v.string())),
      result: v.optional(enums.MaintenanceResult),
      nextDueDate: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("maintenanceRecords not found: " + id);
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
    const doc = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("maintenanceRecords not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── CUSTOM (Phase C) ───────────────────────────────────────────────────────

/**
 * Scrub a deleted Better Auth user's FK references from an org's maintenance
 * records. Re-implements the Prisma `updateMany({ reportedById|assignedToId:
 * userId } → null)` the user-delete sweep used to run against the (now dead)
 * Postgres `maintenance_record` table. For each record where `reportedById` or
 * `assignedToId` equals `userId`, patch the matching field to `undefined`
 * (Convex `db.patch` with a field = `undefined` deletes it → clears to null);
 * the non-matching field is left untouched.
 */
export const scrubUserRefs = mutation({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    await requireService(ctx);
    const docs = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
      .collect();
    let scrubbed = 0;
    for (const doc of docs) {
      const matchReported = doc.reportedById === userId;
      const matchAssigned = doc.assignedToId === userId;
      if (!matchReported && !matchAssigned) continue;
      const patch: { reportedById?: undefined; assignedToId?: undefined } = {};
      if (matchReported) patch.reportedById = undefined;
      if (matchAssigned) patch.assignedToId = undefined;
      await ctx.db.patch(doc._id, patch);
      scrubbed += 1;
    }
    return { scrubbed };
  },
});
