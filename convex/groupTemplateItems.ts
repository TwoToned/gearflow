import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for GroupTemplateItem (Convex table "groupTemplateItems"). GENERATED — Phase 2/5.
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
      .query("groupTemplateItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("groupTemplateItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    templateId: v.string(),
    modelId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("groupTemplateItems", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    templateId: v.string(),
    modelId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("groupTemplateItems").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("groupTemplateItems", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      templateId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      quantity: v.optional(v.number()),
      sortOrder: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("groupTemplateItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("groupTemplateItems not found: " + id);
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
    const doc = await ctx.db.query("groupTemplateItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("groupTemplateItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
