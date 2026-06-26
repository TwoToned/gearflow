import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for FileUpload (Convex table "fileUploads"). GENERATED — Phase 2/5.
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
      .query("fileUploads")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Lookup a file by its proxy `thumbnailUrl` (the data-URI fallback in
 * src/lib/storage.ts). Service-only, cross-org (the caller has no orgId in that
 * path). No index on thumbnailUrl (rare fallback), so this scans + filters.
 */
export const getByThumbnailUrl = query({
  args: { thumbnailUrl: v.string() },
  handler: async (ctx, { thumbnailUrl }) => {
    await requireService(ctx);
    const docs = await ctx.db.query("fileUploads").collect();
    return docs.find((d) => d.thumbnailUrl === thumbnailUrl) ?? null;
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("fileUploads", args);
  },
});

export const createIfMissing = mutation({
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("fileUploads", args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("fileUploads not found: " + id);
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
    const doc = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("fileUploads not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator; re-add on regen. ──
// Is this file referenced by ANY media row across the 7 *_media tables? Replaces
// the raw-SQL UNION ref-count in removeSubHireMedia (each table has a by_fileId
// index). Used to decide whether deleting a media row should also delete its file.
export const isReferencedByMedia = query({
  args: { fileId: v.string() },
  handler: async (ctx, { fileId }) => {
    await requireService(ctx);
    const tables = [
      "modelMedia",
      "assetMedia",
      "kitMedia",
      "projectMedia",
      "clientMedia",
      "locationMedia",
      "subHireMedia",
    ] as const;
    for (const t of tables) {
      const hit = await ctx.db
        .query(t)
        .withIndex("by_fileId", (q) => q.eq("fileId", fileId))
        .first();
      if (hit) return true;
    }
    return false;
  },
});
