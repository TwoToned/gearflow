import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import { collectCapped } from "./lib/pagination";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for WooCommerceOrderLog (Convex table "wooCommerceOrderLogs"). GENERATED — Phase 2/5.
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
    // r9.8-ok: sole caller (getWooCommerceOrderLogsPage) needs the org's full
    // matching set to filter/sort/paginate in JS; no composite index for the
    // (status, createdAt-desc) combination exists yet. Capped, not a bare
    // collect — see docs/exceptions.md R-8.3.3
    const { rows } = await collectCapped(
      ctx.db.query("wooCommerceOrderLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)),
    );
    return rows;
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("wooCommerceOrderLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * The first COMPLETED log for a (org, wooOrderId) — the webhook idempotency check,
 * via the by_wooOrderId index instead of a whole-org collect + JS `.find()`. Public
 * twin of wooCommerceInternal.findCompletedLogByOrder (that one's an internalQuery,
 * unreachable from the Next.js webhook route's client SDK call).
 */
export const findCompletedByOrder = query({
  args: { orgId: v.string(), wooOrderId: v.number() },
  handler: async (ctx, { orgId, wooOrderId }) => {
    await requireService(ctx);
    const rows = await ctx.db.query("wooCommerceOrderLogs").withIndex("by_wooOrderId", (q) => q.eq("wooOrderId", wooOrderId)).collect();
    return rows.find((r) => r.organizationId === orgId && r.status === "COMPLETED") ?? null;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    wooOrderId: v.number(),
    wooOrderNumber: v.optional(v.string()),
    status: enums.WooOrderLogStatus,
    projectId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    payload: v.any(),
    errorMessage: v.optional(v.string()),
    matchResults: v.optional(v.any()),
    dateExtraction: v.optional(v.any()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("wooCommerceOrderLogs", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    wooOrderId: v.number(),
    wooOrderNumber: v.optional(v.string()),
    status: enums.WooOrderLogStatus,
    projectId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    payload: v.any(),
    errorMessage: v.optional(v.string()),
    matchResults: v.optional(v.any()),
    dateExtraction: v.optional(v.any()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("wooCommerceOrderLogs").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("wooCommerceOrderLogs", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      wooOrderId: v.optional(v.number()),
      wooOrderNumber: v.optional(v.string()),
      status: v.optional(enums.WooOrderLogStatus),
      projectId: v.optional(v.string()),
      clientId: v.optional(v.string()),
      payload: v.optional(v.any()),
      errorMessage: v.optional(v.string()),
      matchResults: v.optional(v.any()),
      dateExtraction: v.optional(v.any()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("wooCommerceOrderLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("wooCommerceOrderLogs not found: " + id);
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
    const doc = await ctx.db.query("wooCommerceOrderLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("wooCommerceOrderLogs not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
