import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for FileUpload (Convex table "fileUploads"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("fileUploads")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    storageKey: v.string(),
    url: v.string(),
    thumbnailUrl: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    uploadedById: v.string(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("fileUploads", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      fileName: v.optional(v.string()),
      fileSize: v.optional(v.number()),
      mimeType: v.optional(v.string()),
      storageKey: v.optional(v.string()),
      url: v.optional(v.string()),
      thumbnailUrl: v.optional(v.string()),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      uploadedById: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("fileUploads not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("fileUploads not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
