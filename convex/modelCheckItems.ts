import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for ModelCheckItem (Convex table "modelCheckItems"). GENERATED — Phase 2/5.
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
      .query("modelCheckItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Check items assigned to a single model within an org. Backs
 * getModelFailureAnalytics's read-rewire to Convex (Phase A). Uses the composite
 * by_organizationId_modelId index. Caller sorts by sortOrder asc and resolves
 * checkItem label/type via checkItems.list.
 */
export const listByModel = query({
  args: { orgId: v.string(), modelId: v.string() },
  handler: async (ctx, { orgId, modelId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("modelCheckItems")
      .withIndex("by_organizationId_modelId", (q) =>
        q.eq("organizationId", orgId).eq("modelId", modelId),
      )
      .collect();
  },
});

/** Assignments for one model, org-scoped. Replaces a Prisma findMany by modelId. */
export const listByModelId = query({
  args: { orgId: v.string(), modelId: v.string() },
  handler: async (ctx, { orgId, modelId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("modelCheckItems")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/** Assignments for one check item, org-scoped. Replaces a Prisma findMany by
 *  checkItemId (the `modelCheckItems` include on a single check item). */
export const listByCheckItemId = query({
  args: { orgId: v.string(), checkItemId: v.string() },
  handler: async (ctx, { orgId, checkItemId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("modelCheckItems")
      .withIndex("by_checkItemId", (q) => q.eq("checkItemId", checkItemId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});
/** Get one model-check-item assignment by model + checkItem (first match, org-scoped). */
export const getByModelAndCheckItem = query({
  args: { orgId: v.string(), modelId: v.string(), checkItemId: v.string() },
  handler: async (ctx, { orgId, modelId, checkItemId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("modelCheckItems")
      .withIndex("by_modelId_checkItemId", (q) => q.eq("modelId", modelId).eq("checkItemId", checkItemId))
      .collect();
    return rows.find((r) => r.organizationId === orgId) ?? null;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("modelCheckItems", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("modelCheckItems", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      checkItemId: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelCheckItems not found: " + id);
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
    const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelCheckItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
