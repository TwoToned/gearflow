import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for SubHireGroup (Convex table "subHireGroups"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { subHireId: v.string() },
  handler: async (ctx, { subHireId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("subHireGroups")
      .withIndex("by_subHireId", (q) => q.eq("subHireId", subHireId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    subHireId: v.string(),
    title: v.string(),
    sortOrder: v.optional(v.number()),
    quantity: v.optional(v.number()),
    cost: v.optional(v.number()),
    charge: v.optional(v.number()),
    discount: v.optional(v.number()),
    showOnQuote: v.optional(v.boolean()),
    showOnDocs: v.optional(v.boolean()),
    targetCategoryId: v.optional(v.string()),
    targetGroupId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("subHireGroups", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    subHireId: v.string(),
    title: v.string(),
    sortOrder: v.optional(v.number()),
    quantity: v.optional(v.number()),
    cost: v.optional(v.number()),
    charge: v.optional(v.number()),
    discount: v.optional(v.number()),
    showOnQuote: v.optional(v.boolean()),
    showOnDocs: v.optional(v.boolean()),
    targetCategoryId: v.optional(v.string()),
    targetGroupId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("subHireGroups", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      subHireId: v.optional(v.string()),
      title: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      quantity: v.optional(v.number()),
      cost: v.optional(v.number()),
      charge: v.optional(v.number()),
      discount: v.optional(v.number()),
      showOnQuote: v.optional(v.boolean()),
      showOnDocs: v.optional(v.boolean()),
      targetCategoryId: v.optional(v.string()),
      targetGroupId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("subHireGroups not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("subHireGroups not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── CUSTOM (sub-hire write-inversion, Phase C — re-add on a `pnpm convex:crud` regen) ───

/** Patch a sub-hire group with explicit field clears (target* → unset). See the note
 *  on subHires.patchSubHire — `toConvexDoc` drops nulls, so clears need this. */
export const patchGroup = mutation({
  args: {
    id: v.string(),
    set: v.object({
      title: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      quantity: v.optional(v.number()),
      cost: v.optional(v.number()),
      charge: v.optional(v.number()),
      discount: v.optional(v.number()),
      showOnQuote: v.optional(v.boolean()),
      showOnDocs: v.optional(v.boolean()),
      targetCategoryId: v.optional(v.string()),
      targetGroupId: v.optional(v.string()),
    }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("subHireGroups not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

/** Ungroup all child items (clear their `groupId`) then delete the group — atomic. */
export const deleteWithUngroup = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("subHireGroups not found: " + id);
    const children = await ctx.db.query("subHireItems").withIndex("by_groupId", (q) => q.eq("groupId", id)).collect();
    for (const c of children) await ctx.db.patch(c._id, { groupId: undefined });
    await ctx.db.delete(doc._id);
  },
});
