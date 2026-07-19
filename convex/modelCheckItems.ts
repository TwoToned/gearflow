import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for ModelCheckItem (Convex table "modelCheckItems"). GENERATED — Phase 2/5.
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
      .query("modelCheckItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Check items assigned to a single model within an org. Backs
 * getModelFailureAnalytics's read-rewire to Convex (Phase A). Uses the composite
 * by_organizationId_modelId index. Caller sorts by sortOrder asc and resolves
 * checkItem label/type via checkItems.list.
 */
export const listByModel = query({
  args: { orgId: v.string(), modelId: v.string() },
  handler: async (ctx, { orgId, modelId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("modelCheckItems")
      .withIndex("by_organizationId_modelId", (q) =>
        q.eq("organizationId", orgId).eq("modelId", modelId),
      )
      .collect();
  },
});

/**
 * Enriched assignments for one model (sortOrder asc) with the nested `checkItem`
 * doc — browser-direct replacement for getModelCheckItems (item-check-form +
 * warehouse "pass all remaining"). Joins the checkItem by id (org re-checked;
 * by_cuid is global) and drops rows whose check item is missing/cross-org.
 */
export const assignmentsForModel = query({
  args: { orgId: v.string(), modelId: v.string() },
  handler: async (ctx, { orgId, modelId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = (await ctx.db.query("modelCheckItems").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect())
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

/** Assignments for one model, org-scoped. Replaces a Prisma findMany by modelId. */
export const listByModelId = query({
  args: { orgId: v.string(), modelId: v.string() },
  handler: async (ctx, { orgId, modelId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("modelCheckItems")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/** Assignments for one check item, org-scoped. Replaces a Prisma findMany by
 *  checkItemId (the `modelCheckItems` include on a single check item). */
export const listByCheckItemId = query({
  args: { orgId: v.string(), checkItemId: v.string() },
  handler: async (ctx, { orgId, checkItemId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("modelCheckItems")
      .withIndex("by_checkItemId", (q) => q.eq("checkItemId", checkItemId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});
/** Get one model-check-item assignment by model + checkItem (first match, org-scoped). */
export const getByModelAndCheckItem = query({
  args: { orgId: v.string(), modelId: v.string(), checkItemId: v.string() },
  handler: async (ctx, { orgId, modelId, checkItemId }) => {
    await requireOrgRead(ctx, orgId);
    const rows = await ctx.db
      .query("modelCheckItems")
      .withIndex("by_modelId_checkItemId", (q) => q.eq("modelId", modelId).eq("checkItemId", checkItemId))
      .collect();
    return rows.find((r) => r.organizationId === orgId) ?? null;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("modelCheckItems", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    checkItemId: v.string(),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("modelCheckItems", args);
    return { _id, created: true };
  },
});

/**
 * Create N model↔check-item assignments in ONE array mutation (bulk single-call
 * invariant, Phase 3) — replaces the server firing one `createIfMissing` per
 * (model × checkItem) pair when bulk-assigning checks to models (N×M round-trips).
 * `organizationId` is stamped from the ARG onto every row (a caller can't smuggle a
 * per-row org), and each row is inserted only if its id is new (idempotent on retry;
 * the caller pre-dedups by model+checkItem). Returns how many were created.
 */
export const createManyIfMissing = mutation({
  args: {
    organizationId: v.string(),
    rows: v.array(
      v.object({
        id: v.string(),
        modelId: v.string(),
        checkItemId: v.string(),
        sortOrder: v.optional(v.number()),
        createdAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { organizationId, rows }) => {
    await requireService(ctx);
    let created = 0;
    for (const r of rows) {
      const existing = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", r.id)).unique();
      if (existing) continue;
      await ctx.db.insert("modelCheckItems", { ...r, organizationId });
      created++;
    }
    return { created };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      checkItemId: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelCheckItems not found: " + id);
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
    const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("modelCheckItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Atomic drag-reorder: assign sortOrder = index for each assignment id in `orderedIds`,
 * in ONE mutation round-trip (was a `Promise.all` firing one read + one `update` per
 * item). The caller resolves (model, checkItem) → row id once via listByModel, then
 * passes the row ids in display order. Per-item org re-check: by_cuid is a GLOBAL index,
 * so the `doc.organizationId === orgId` skip prevents reordering another org's rows.
 */
export const reorderMany = mutation({
  // Explicit {id, sortOrder} pairs (not array-index) so the caller can resolve/filter
  // ids without compressing the sort positions of the survivors.
  args: { orgId: v.string(), items: v.array(v.object({ id: v.string(), sortOrder: v.number() })) },
  handler: async (ctx, { orgId, items }) => {
    await requireService(ctx);
    for (const it of items) {
      const doc = await ctx.db.query("modelCheckItems").withIndex("by_cuid", (q) => q.eq("id", it.id)).unique();
      if (doc && doc.organizationId === orgId) await ctx.db.patch(doc._id, { sortOrder: it.sortOrder }); // per-item org re-check
    }
  },
});
