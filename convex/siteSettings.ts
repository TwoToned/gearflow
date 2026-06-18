import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for SiteSettings (Convex table "siteSettings"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: {},
  handler: async (ctx, _args) => {
    await requireService(ctx);
    return await ctx.db.query("siteSettings").collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("siteSettings").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
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
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("siteSettings", args);
  },
});

export const createIfMissing = mutation({
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
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("siteSettings").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("siteSettings", args);
    return { _id, created: true };
  },
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
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("siteSettings").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("siteSettings not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("siteSettings").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("siteSettings not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator. Re-add if regenerating
// convex/siteSettings.ts via `pnpm convex:crud`. ─────────────────────────────

// siteSettings is a platform-global SINGLETON (one row). getSingleton returns it
// (or null) without the caller knowing its cuid — replaces the
// `prisma.siteSettings.findFirst` reads now that the table is Convex-only.
export const getSingleton = query({
  args: {},
  handler: async (ctx) => {
    await requireService(ctx);
    return await ctx.db.query("siteSettings").first();
  },
});

// Upsert the singleton: patch the (at most one) existing row, else insert one
// seeded with the provided id + Prisma-equivalent defaults. A single mutation is
// serializable, so two concurrent first-time saves can't create two singletons —
// the loser conflicts on the table read the winner's insert touched, retries, and
// patches the winner's row. Nullable fields (platformIcon/platformLogo) pass
// `null` to CLEAR: translated to `undefined` so db.patch removes the field (Convex
// treats undefined as removal). Returns the full row.
export const upsertSingleton = mutation({
  args: {
    fallbackId: v.string(),
    now: v.number(),
    patch: v.object({
      platformName: v.optional(v.string()),
      platformIcon: v.optional(v.union(v.string(), v.null())),
      platformLogo: v.optional(v.union(v.string(), v.null())),
      registrationPolicy: v.optional(v.string()),
      twoFactorGlobalPolicy: v.optional(v.string()),
      defaultCurrency: v.optional(v.string()),
      defaultTaxRate: v.optional(v.number()),
      allowOrgCreation: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { fallbackId, now, patch }) => {
    await requireService(ctx);
    // null → undefined so db.patch removes the optional field (clear-to-null).
    const norm: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) norm[k] = val === null ? undefined : val;

    const existing = await ctx.db.query("siteSettings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { ...norm, updatedAt: now });
      return (await ctx.db.get(existing._id))!;
    }
    const _id = await ctx.db.insert("siteSettings", {
      id: fallbackId,
      platformName: "GearFlow",
      registrationPolicy: "OPEN",
      twoFactorGlobalPolicy: "OFF",
      defaultCurrency: "AUD",
      defaultTaxRate: 10,
      allowOrgCreation: true,
      createdAt: now,
      updatedAt: now,
      ...norm,
    });
    return (await ctx.db.get(_id))!;
  },
});
