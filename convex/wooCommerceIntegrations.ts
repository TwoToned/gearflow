import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Thin CRUD for WooCommerceIntegration (Convex table "wooCommerceIntegrations"). GENERATED — Phase 2.
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
      .query("wooCommerceIntegrations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    isEnabled: v.optional(v.boolean()),
    webhookSecret: v.string(),
    storeUrl: v.optional(v.string()),
    productMatchField: v.optional(v.string()),
    customFieldKey: v.optional(v.string()),
    rentalStartKey: v.optional(v.string()),
    rentalEndKey: v.optional(v.string()),
    eventStartKey: v.optional(v.string()),
    deliveryAddressKey: v.optional(v.string()),
    notesKey: v.optional(v.string()),
    dateFormat: v.optional(v.string()),
    locationMetaKey: v.optional(v.string()),
    defaultLocationId: v.optional(v.string()),
    defaultProjectType: v.optional(v.string()),
    autoConfirmEnquiry: v.optional(v.boolean()),
    notifyUserIds: v.optional(v.array(v.string())),
    lastPayload: v.optional(v.any()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("wooCommerceIntegrations", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      isEnabled: v.optional(v.boolean()),
      webhookSecret: v.optional(v.string()),
      storeUrl: v.optional(v.string()),
      productMatchField: v.optional(v.string()),
      customFieldKey: v.optional(v.string()),
      rentalStartKey: v.optional(v.string()),
      rentalEndKey: v.optional(v.string()),
      eventStartKey: v.optional(v.string()),
      deliveryAddressKey: v.optional(v.string()),
      notesKey: v.optional(v.string()),
      dateFormat: v.optional(v.string()),
      locationMetaKey: v.optional(v.string()),
      defaultLocationId: v.optional(v.string()),
      defaultProjectType: v.optional(v.string()),
      autoConfirmEnquiry: v.optional(v.boolean()),
      notifyUserIds: v.optional(v.array(v.string())),
      lastPayload: v.optional(v.any()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("wooCommerceIntegrations not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("wooCommerceIntegrations not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
