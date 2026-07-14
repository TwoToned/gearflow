import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for Category (Convex table "categories"). GENERATED — Phase 2/5.
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
      .query("categories")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Per-category model + kit counts (categoryId → { models, kits }) for the category
 * manager — browser-native replacement for the getCategoryCounts server action.
 * Tallies every org model and kit that has a categoryId (parity with
 * buildModelKitCounts, no filter). Fetched ONE-SHOT by the manager (counts have no
 * liveness need), so this is not a reactive org-wide subscription (Appendix B).
 */
export const counts = query({
  args: { orgId: v.string() },
  returns: v.record(v.string(), v.object({ models: v.number(), kits: v.number() })),
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const out: Record<string, { models: number; kits: number }> = {};
    const ensure = (id: string) => (out[id] ??= { models: 0, kits: 0 });

    const models = await ctx.db
      .query("models")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const m of models) if (m.categoryId) ensure(m.categoryId).models++;

    const kits = await ctx.db
      .query("kits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const k of kits) if (k.categoryId) ensure(k.categoryId).kits++;

    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    parentId: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    suggestedCrewRoles: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("categories", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    parentId: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    suggestedCrewRoles: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("categories", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      parentId: v.optional(v.string()),
      description: v.optional(v.string()),
      icon: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      suggestedCrewRoles: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("categories not found: " + id);
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
    const doc = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("categories not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
