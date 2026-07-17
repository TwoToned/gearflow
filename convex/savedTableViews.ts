import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for SavedTableView (Convex table "savedTableViews"). GENERATED — Phase 2/5.
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
      .query("savedTableViews")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("savedTableViews").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    tableId: v.string(),
    name: v.string(),
    config: v.any(),
    isDefault: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("savedTableViews", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    tableId: v.string(),
    name: v.string(),
    config: v.any(),
    isDefault: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("savedTableViews").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("savedTableViews", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      userId: v.optional(v.string()),
      tableId: v.optional(v.string()),
      name: v.optional(v.string()),
      config: v.optional(v.any()),
      isDefault: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("savedTableViews").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("savedTableViews not found: " + id);
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
    const doc = await ctx.db.query("savedTableViews").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("savedTableViews not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Atomically clear any existing defaults for user+table, then create the new
 * view. Single Convex transaction prevents a concurrent create from leaving
 * two defaults.
 */
export const createForUser = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    tableId: v.string(),
    name: v.string(),
    config: v.any(),
    isDefault: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, userId, tableId, name, config, isDefault, now }) => {
    await requireService(ctx);
    if (isDefault) {
      const views = await ctx.db
        .query("savedTableViews")
        .withIndex("by_userId_tableId", (q) => q.eq("userId", userId).eq("tableId", tableId))
        .collect();
      for (const view of views) {
        if (view.isDefault && view.organizationId === organizationId) {
          await ctx.db.patch(view._id, { isDefault: false, updatedAt: now });
        }
      }
    }
    return await ctx.db.insert("savedTableViews", {
      id, organizationId, userId, tableId, name, config, isDefault, createdAt: now, updatedAt: now,
    });
  },
});

/**
 * Atomically clear all defaults for user+table and optionally set a new one.
 * Passing null for targetId just clears without setting.
 */
export const setDefault = mutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    tableId: v.string(),
    targetId: v.union(v.string(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, userId, tableId, targetId, now }) => {
    await requireService(ctx);
    const views = await ctx.db
      .query("savedTableViews")
      .withIndex("by_userId_tableId", (q) => q.eq("userId", userId).eq("tableId", tableId))
      .collect();
    for (const view of views) {
      if (view.isDefault && view.organizationId === organizationId) {
        await ctx.db.patch(view._id, { isDefault: false, updatedAt: now });
      }
    }
    if (targetId) {
      const target = await ctx.db
        .query("savedTableViews")
        .withIndex("by_cuid", (q) => q.eq("id", targetId))
        .unique();
      if (!target || target.organizationId !== organizationId || target.userId !== userId || target.tableId !== tableId) {
        throw new ConvexError("savedTableViews not found: " + targetId);
      }
      await ctx.db.patch(target._id, { isDefault: true, updatedAt: now });
    }
  },
});
