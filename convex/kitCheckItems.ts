import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for KitCheckItem (Convex table "kitCheckItems"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("kitCheckItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("kitCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/** Assignments for one kit, org-scoped. Replaces a Prisma findMany by kitId. */
export const listByKitId = query({
  args: { orgId: v.string(), kitId: v.string() },
  handler: async (ctx, { orgId, kitId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("kitCheckItems")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/**
 * Enriched assignments for one kit (sortOrder asc) with the nested `checkItem`
 * doc — browser-direct replacement for getKitCheckItems (item-check-form +
 * warehouse "pass all remaining"). Joins the checkItem by id (org re-checked).
 */
export const assignmentsForKit = query({
  args: { orgId: v.string(), kitId: v.string() },
  handler: async (ctx, { orgId, kitId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = (await ctx.db.query("kitCheckItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect())
      .filter((r) => r.organizationId === orgId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const out = [];
    for (const r of rows) {
      const ci = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", r.checkItemId)).first();
      if (!ci || ci.organizationId !== orgId) continue;
      out.push({ id: r.id, sortOrder: r.sortOrder ?? 0, checkItem: ci });
    }
    return out;
  },
});

/** Assignments for one check item across all kits, org-scoped (delete guard). */
export const listByCheckItemId = query({
  args: { orgId: v.string(), checkItemId: v.string() },
  handler: async (ctx, { orgId, checkItemId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("kitCheckItems")
      .withIndex("by_checkItemId", (q) => q.eq("checkItemId", checkItemId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/** Get one kit-check-item assignment by kit + checkItem (first match, org-scoped). */
export const getByKitAndCheckItem = query({
  args: { orgId: v.string(), kitId: v.string(), checkItemId: v.string() },
  handler: async (ctx, { orgId, kitId, checkItemId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("kitCheckItems")
      .withIndex("by_kitId_checkItemId", (q) => q.eq("kitId", kitId).eq("checkItemId", checkItemId))
      .collect();
    return rows.find((r) => r.organizationId === orgId) ?? null;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("kitCheckItems", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    kitId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("kitCheckItems").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("kitCheckItems", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      checkItemId: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("kitCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("kitCheckItems not found: " + id);
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
    const doc = await ctx.db.query("kitCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("kitCheckItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Atomic drag-reorder: assign sortOrder = index for each assignment id in `orderedIds`,
 * in ONE mutation round-trip (was a `Promise.all` firing one read + one `update` per
 * item). The caller resolves (kit, checkItem) → row id once via listByKitId, then passes
 * the row ids in display order. Per-item org re-check: by_cuid is a GLOBAL index, so the
 * `doc.organizationId === orgId` skip prevents reordering another org's rows.
 */
export const reorderMany = mutation({
  // Explicit {id, sortOrder} pairs (not array-index) so the caller can resolve/filter
  // ids without compressing the sort positions of the survivors.
  args: { orgId: v.string(), items: v.array(v.object({ id: v.string(), sortOrder: v.number() })) },
  handler: async (ctx, { orgId, items }) => {
    await requireService(ctx);
    for (const it of items) {
      const doc = await ctx.db.query("kitCheckItems").withIndex("by_cuid", (q) => q.eq("id", it.id)).unique();
      if (doc && doc.organizationId === orgId) await ctx.db.patch(doc._id, { sortOrder: it.sortOrder }); // per-item org re-check
    }
  },
});
