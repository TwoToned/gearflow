import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for WooCommerceIntegration (Convex table "wooCommerceIntegrations"). GENERATED — Phase 2/5.
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
      .query("wooCommerceIntegrations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
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
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("wooCommerceIntegrations", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
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
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("wooCommerceIntegrations", args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("wooCommerceIntegrations not found: " + id);
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
    const doc = await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("wooCommerceIntegrations not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── CUSTOM (Phase C) ───
// The generated `update` mutation can't unset a field (the wire drops nulls).
// `patchWooCommerceIntegration` applies `set` then explicitly clears each key in
// `clear` to `undefined`, so optional string fields (storeUrl, customFieldKey,
// rentalStartKey, etc.) can be emptied. Mirrors convex/subHires.ts patchSubHire.
export const patchWooCommerceIntegration = mutation({
  args: {
    id: v.string(),
    set: v.object({
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
      updatedAt: v.optional(v.number()),
    }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("wooCommerceIntegrations not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});
