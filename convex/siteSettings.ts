import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for SiteSettings (Convex table "siteSettings"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: {},
  handler: async (ctx, _args) =>
    await ctx.db.query("siteSettings").collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("siteSettings").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    platformName: v.optional(v.string()),
    platformIcon: v.optional(v.string()),
    platformLogo: v.optional(v.string()),
    registrationPolicy: v.optional(v.string()),
    twoFactorGlobalPolicy: v.optional(v.string()),
    defaultCurrency: v.optional(v.string()),
    defaultTaxRate: v.optional(v.number()),
    allowOrgCreation: v.optional(v.boolean()),
    socialLoginGoogle: v.optional(v.boolean()),
    socialLoginMicrosoft: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("siteSettings", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      platformName: v.optional(v.string()),
      platformIcon: v.optional(v.string()),
      platformLogo: v.optional(v.string()),
      registrationPolicy: v.optional(v.string()),
      twoFactorGlobalPolicy: v.optional(v.string()),
      defaultCurrency: v.optional(v.string()),
      defaultTaxRate: v.optional(v.number()),
      allowOrgCreation: v.optional(v.boolean()),
      socialLoginGoogle: v.optional(v.boolean()),
      socialLoginMicrosoft: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("siteSettings").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("siteSettings not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("siteSettings").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("siteSettings not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
