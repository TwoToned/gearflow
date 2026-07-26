import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgRead } from "./lib/auth";

/**
 * Thin CRUD for GroupTemplateItem (Convex table "groupTemplateItems"). GENERATED — Phase 2/5.
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
    // Browser-readable (Phase 3): composed client-side with the parent templates for
    // the settings page + equipment tab. requireOrgRead accepts the service token OR a
    // user token scoped to `orgId`; rows are org-scoped via by_organizationId. The
    // caller filters by templateId in JS (templateId has no dedicated index).
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("groupTemplateItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
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
    if (!doc) throw new ConvexError("groupTemplateItems not found: " + id);
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
    if (!doc) throw new ConvexError("groupTemplateItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
