import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for DocumentTemplate (Convex table "documentTemplates"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("documentTemplates")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: small bounded per-org template set
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("documentTemplates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    type: v.string(),
    basePdf: v.optional(v.string()),
    schemas: v.optional(v.string()),
    settings: v.optional(v.string()),
    sections: v.optional(v.string()),
    brandTemplateId: v.optional(v.string()),
    thumbnailData: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    isDraft: v.optional(v.boolean()),
    version: v.optional(v.number()),
    thumbnailUrl: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("documentTemplates", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    type: v.string(),
    basePdf: v.optional(v.string()),
    schemas: v.optional(v.string()),
    settings: v.optional(v.string()),
    sections: v.optional(v.string()),
    brandTemplateId: v.optional(v.string()),
    thumbnailData: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    isDraft: v.optional(v.boolean()),
    version: v.optional(v.number()),
    thumbnailUrl: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("documentTemplates").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("documentTemplates", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      type: v.optional(v.string()),
      basePdf: v.optional(v.string()),
      schemas: v.optional(v.string()),
      settings: v.optional(v.string()),
      sections: v.optional(v.string()),
      brandTemplateId: v.optional(v.string()),
      thumbnailData: v.optional(v.string()),
      isDefault: v.optional(v.boolean()),
      isDraft: v.optional(v.boolean()),
      version: v.optional(v.number()),
      thumbnailUrl: v.optional(v.string()),
      publishedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("documentTemplates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("documentTemplates not found: " + id);
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
    const doc = await ctx.db.query("documentTemplates").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("documentTemplates not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
