import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for TestTagAuditorToken (Convex table "testTagAuditorTokens"). GENERATED — Phase 2/5.
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
      .query("testTagAuditorTokens")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("testTagAuditorTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Look up a token by its SHA-256 `tokenHash` (the secure public-endpoint lookup
 * the old Prisma `findUnique({ where: { tokenHash } })` did — `tokenHash` is the
 * `@unique` column). Service-only; the auditor-portal public route validates the
 * raw token by hashing then calling this (then re-checks isActive + expiry in the
 * server action). HAND-ADDED for Phase B write inversion (bucket-2 tokens). Uses
 * `.unique()` on by_tokenHash to preserve the one-row-per-hash invariant.
 */
export const getByTokenHash = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagAuditorTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    isActive: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    createdById: v.string(),
    lastAccessedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("testTagAuditorTokens", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    isActive: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    createdById: v.string(),
    lastAccessedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("testTagAuditorTokens").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("testTagAuditorTokens", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      token: v.optional(v.string()),
      tokenHash: v.optional(v.string()),
      isActive: v.optional(v.boolean()),
      expiresAt: v.optional(v.number()),
      scope: v.optional(v.string()),
      createdById: v.optional(v.string()),
      lastAccessedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("testTagAuditorTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testTagAuditorTokens not found: " + id);
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
    const doc = await ctx.db.query("testTagAuditorTokens").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testTagAuditorTokens not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
