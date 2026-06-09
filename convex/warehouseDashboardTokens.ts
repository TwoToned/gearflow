import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for WarehouseDashboardToken (Convex table "warehouseDashboardTokens"). GENERATED — Phase 2/5.
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
      .query("warehouseDashboardTokens")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("warehouseDashboardTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    locationId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    layout: v.optional(v.string()),
    createdById: v.string(),
    lastAccessedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("warehouseDashboardTokens", args);
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      token: v.optional(v.string()),
      tokenHash: v.optional(v.string()),
      locationId: v.optional(v.string()),
      isActive: v.optional(v.boolean()),
      layout: v.optional(v.string()),
      createdById: v.optional(v.string()),
      lastAccessedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("warehouseDashboardTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("warehouseDashboardTokens not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("warehouseDashboardTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("warehouseDashboardTokens not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
