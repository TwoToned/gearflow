import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Stocktake (Convex table "stocktakes"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("stocktakes")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("stocktakes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    locationId: v.string(),
    scope: enums.StocktakeScope,
    categoryId: v.optional(v.string()),
    status: v.optional(enums.StocktakeStatus),
    startedAt: v.optional(v.number()),
    startedById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    reviewedById: v.optional(v.string()),
    expectedCount: v.optional(v.number()),
    foundCount: v.optional(v.number()),
    missingCount: v.optional(v.number()),
    unexpectedCount: v.optional(v.number()),
    discrepancyCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("stocktakes", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    locationId: v.string(),
    scope: enums.StocktakeScope,
    categoryId: v.optional(v.string()),
    status: v.optional(enums.StocktakeStatus),
    startedAt: v.optional(v.number()),
    startedById: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    reviewedById: v.optional(v.string()),
    expectedCount: v.optional(v.number()),
    foundCount: v.optional(v.number()),
    missingCount: v.optional(v.number()),
    unexpectedCount: v.optional(v.number()),
    discrepancyCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("stocktakes").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("stocktakes", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      locationId: v.optional(v.string()),
      scope: v.optional(enums.StocktakeScope),
      categoryId: v.optional(v.string()),
      status: v.optional(enums.StocktakeStatus),
      startedAt: v.optional(v.number()),
      startedById: v.optional(v.string()),
      completedAt: v.optional(v.number()),
      reviewedById: v.optional(v.string()),
      expectedCount: v.optional(v.number()),
      foundCount: v.optional(v.number()),
      missingCount: v.optional(v.number()),
      unexpectedCount: v.optional(v.number()),
      discrepancyCount: v.optional(v.number()),
      notes: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("stocktakes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("stocktakes not found: " + id);
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
    const doc = await ctx.db.query("stocktakes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("stocktakes not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
