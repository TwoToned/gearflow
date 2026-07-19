import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for AssetMedia (Convex table "assetMedia"). GENERATED — Phase 2/5.
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
      .query("assetMedia")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — org-wide primary-media map
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("assetMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const listByParent = query({
  args: { parentId: v.string() },
  handler: async (ctx, { parentId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("assetMedia")
      .withIndex("by_assetId", (q) => q.eq("assetId", parentId))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    isPrimary: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("assetMedia", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetId: v.string(),
    fileId: v.string(),
    type: v.optional(enums.MediaType),
    isPrimary: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("assetMedia").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("assetMedia", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      fileId: v.optional(v.string()),
      type: v.optional(enums.MediaType),
      isPrimary: v.optional(v.boolean()),
      displayName: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assetMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assetMedia not found: " + id);
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
    const doc = await ctx.db.query("assetMedia").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assetMedia not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator; re-add on regen. ──
// Atomic single-primary-photo invariant: within one parent, exactly the target
// PHOTO row is primary. Replaces the Prisma updateMany+update transaction.
export const setPrimary = mutation({
  args: { parentId: v.string(), mediaId: v.string() },
  handler: async (ctx, { parentId, mediaId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("assetMedia")
      .withIndex("by_assetId", (q) => q.eq("assetId", parentId))
      .collect();
    for (const r of rows) {
      if (r.id === mediaId) {
        if (!r.isPrimary) await ctx.db.patch(r._id, { isPrimary: true });
      } else if (r.type === "PHOTO" && r.isPrimary) {
        await ctx.db.patch(r._id, { isPrimary: false });
      }
    }
  },
});
