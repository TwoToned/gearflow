import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CheckItem (Convex table "checkItems"). GENERATED — Phase 2/5.
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
      .query("checkItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    type: v.optional(enums.CheckItemType),
    category: v.optional(v.string()),
    measurementUnit: v.optional(v.string()),
    measurementMin: v.optional(v.number()),
    measurementMax: v.optional(v.number()),
    dropdownOptions: v.optional(v.any()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("checkItems", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    type: v.optional(enums.CheckItemType),
    category: v.optional(v.string()),
    measurementUnit: v.optional(v.string()),
    measurementMin: v.optional(v.number()),
    measurementMax: v.optional(v.number()),
    dropdownOptions: v.optional(v.any()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("checkItems", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      label: v.optional(v.string()),
      description: v.optional(v.string()),
      type: v.optional(enums.CheckItemType),
      category: v.optional(v.string()),
      measurementUnit: v.optional(v.string()),
      measurementMin: v.optional(v.number()),
      measurementMax: v.optional(v.number()),
      dropdownOptions: v.optional(v.any()),
      createdById: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("checkItems not found: " + id);
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
    const doc = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("checkItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── CUSTOM (Phase C) ───
// The generated `update` mutation can't unset a field (the wire drops nulls).
// `patchCheckItem` applies `set` then explicitly clears each key in `clear` to
// `undefined`, so optional fields (description, category, measurementUnit,
// measurementMin/Max, dropdownOptions) can be emptied when an edit drops them
// (e.g. switching a check item's type). Mirrors convex/subHires.ts patchSubHire.
export const patchCheckItem = mutation({
  args: {
    id: v.string(),
    set: v.object({
      label: v.optional(v.string()),
      description: v.optional(v.string()),
      type: v.optional(enums.CheckItemType),
      category: v.optional(v.string()),
      measurementUnit: v.optional(v.string()),
      measurementMin: v.optional(v.number()),
      measurementMax: v.optional(v.number()),
      dropdownOptions: v.optional(v.any()),
      updatedAt: v.optional(v.number()),
    }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("checkItems not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});
