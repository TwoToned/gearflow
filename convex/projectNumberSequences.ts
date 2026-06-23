import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for ProjectNumberSequence (Convex table "projectNumberSequences"). GENERATED — Phase 2/5.
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
      .query("projectNumberSequences")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("projectNumberSequences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    scopeKey: v.string(),
    value: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectNumberSequences", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    scopeKey: v.string(),
    value: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectNumberSequences").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectNumberSequences", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      scopeKey: v.optional(v.string()),
      value: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectNumberSequences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectNumberSequences not found: " + id);
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
    const doc = await ctx.db.query("projectNumberSequences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectNumberSequences not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── CUSTOM (project keystone write-inversion, Phase C) ───

/** The current counter row for `(organizationId, scopeKey)` — powers the
 *  no-increment "next number" preview (peekNextProjectNumber). */
export const getByOrgAndScopeKey = query({
  args: { organizationId: v.string(), scopeKey: v.string() },
  handler: async (ctx, { organizationId, scopeKey }) => {
    await requireService(ctx);
    return await ctx.db
      .query("projectNumberSequences")
      .withIndex("by_organizationId_scopeKey", (q) => q.eq("organizationId", organizationId).eq("scopeKey", scopeKey))
      .unique();
  },
});

/**
 * Atomically allocate the next sequence value for `(organizationId, scopeKey)` —
 * the Convex equivalent of the Postgres `INSERT … ON CONFLICT … value = value + 1
 * RETURNING value`. Convex mutations are serializable on the documents they touch,
 * so concurrent project creates conflict on the by_organizationId_scopeKey read
 * range and retry, never double-allocating. `newId` is the cuid used only when the
 * counter row is first created (ignored if it already exists). Returns the new value.
 */
export const reserveNextNumber = mutation({
  args: { organizationId: v.string(), scopeKey: v.string(), newId: v.string(), now: v.number() },
  handler: async (ctx, { organizationId, scopeKey, newId, now }) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("projectNumberSequences")
      .withIndex("by_organizationId_scopeKey", (q) => q.eq("organizationId", organizationId).eq("scopeKey", scopeKey))
      .unique();
    if (existing) {
      const value = (existing.value ?? 0) + 1;
      await ctx.db.patch(existing._id, { value, updatedAt: now });
      return value;
    }
    await ctx.db.insert("projectNumberSequences", { id: newId, organizationId, scopeKey, value: 1, updatedAt: now });
    return 1;
  },
});
