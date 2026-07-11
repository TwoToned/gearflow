import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for ProjectTask (Convex table "projectTasks"). GENERATED — Phase 2/5.
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
      .query("projectTasks")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const listByProject = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("projectTasks")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(enums.ProjectTaskStatus),
    priority: v.optional(enums.ProjectTaskPriority),
    dueDate: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    checklist: v.optional(v.any()),
    assigneeUserId: v.optional(v.string()),
    assigneeCrewId: v.optional(v.string()),
    createdById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectTasks", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(enums.ProjectTaskStatus),
    priority: v.optional(enums.ProjectTaskPriority),
    dueDate: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
    checklist: v.optional(v.any()),
    assigneeUserId: v.optional(v.string()),
    assigneeCrewId: v.optional(v.string()),
    createdById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectTasks", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      status: v.optional(enums.ProjectTaskStatus),
      priority: v.optional(enums.ProjectTaskPriority),
      dueDate: v.optional(v.number()),
      sortOrder: v.optional(v.number()),
      checklist: v.optional(v.any()),
      assigneeUserId: v.optional(v.string()),
      assigneeCrewId: v.optional(v.string()),
      createdById: v.optional(v.string()),
      completedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectTasks not found: " + id);
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
    const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectTasks not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── Bulk (multi-select) operations ────────────────────────────────────────
// One mutation round-trip for an N-task bulk action instead of one server→Convex
// call per row. Org-scoped per row (by_cuid is global); foreign rows skipped.

/** Bulk-apply a shared patch to N tasks. `patch` carries the resolved shared
 *  fields (status / priority / dueDate ms / assignee); the DONE completedAt stamp
 *  is derived per row against its own current status. */
export const updateMany = mutation({
  args: { ids: v.array(v.string()), orgId: v.string(), patch: v.any(), now: v.number() },
  handler: async (ctx, { ids, orgId, patch, now }) => {
    await requireService(ctx);
    const p = patch as Record<string, unknown>;
    const projectIds = new Set<string>();
    let updated = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      const applied: Record<string, unknown> = { ...p, updatedAt: now };
      delete applied.organizationId;
      if (p.status !== undefined && p.status !== doc.status) {
        applied.completedAt = p.status === "DONE" ? now : null;
      }
      await ctx.db.patch(doc._id, applied);
      projectIds.add(doc.projectId);
      updated++;
    }
    return { updated, skipped, projectIds: [...projectIds] };
  },
});

/** Bulk-delete N tasks in one pass. */
export const removeMany = mutation({
  args: { ids: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { ids, orgId }) => {
    await requireService(ctx);
    const projectIds = new Set<string>();
    let deleted = 0;
    let skipped = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== orgId) { skipped++; continue; }
      await ctx.db.delete(doc._id);
      projectIds.add(doc.projectId);
      deleted++;
    }
    return { deleted, skipped, projectIds: [...projectIds] };
  },
});
