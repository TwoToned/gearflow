import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for ProjectManager (Convex table "projectManagers"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("projectManagers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectManagers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
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
      .query("projectManagers")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()).filter((r) => r.organizationId === orgId);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    userId: v.string(),
    addedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectManagers", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    userId: v.string(),
    addedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectManagers").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectManagers", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      userId: v.optional(v.string()),
      addedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectManagers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectManagers not found: " + id);
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
    const doc = await ctx.db.query("projectManagers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectManagers not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Apply a manager diff to a project in ONE atomic mutation — collapses the
 * client's `Promise.all([...toAdd.map(addProjectManager), ...toRemove.map(
 * removeProjectManager)])` fan-out (one round-trip per manager) into a single
 * call. The server action computes the diff (it needs the current rows for
 * member validation + audit logging anyway); this mutation just inserts the new
 * rows (createIfMissing by cuid) and deletes the removed rows.
 */
export const applyDiff = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    add: v.array(v.object({ id: v.string(), userId: v.string(), addedAt: v.number() })),
    removeIds: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    for (const m of a.add) {
      // Dedupe on (projectId, userId), not the fresh cuid, so two calls racing
      // from the same starting state can't both insert the same manager (the
      // by_cuid check would miss it — each generates a different id).
      const existing = await ctx.db
        .query("projectManagers")
        .withIndex("by_projectId_userId", (q) => q.eq("projectId", a.projectId).eq("userId", m.userId))
        .first();
      if (existing) continue;
      await ctx.db.insert("projectManagers", {
        id: m.id,
        organizationId: a.organizationId,
        projectId: a.projectId,
        userId: m.userId,
        addedAt: m.addedAt,
      });
    }
    for (const id of a.removeIds) {
      const doc = await ctx.db.query("projectManagers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (doc) await ctx.db.delete(doc._id);
    }
  },
});
