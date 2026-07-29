import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for ProjectLineItemUnit (Convex table "projectLineItemUnits"). GENERATED — Phase 2/5.
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
    // Widened (Phase 5 domain slice, #1001): a plain org-scoped read (by_organizationId),
    // no special sensitivity beyond ordinary fulfillment/serial data.
    await requireOrgPermission(ctx, orgId, "project", "read");
    return await ctx.db
      .query("projectLineItemUnits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    // NOT widened: point-read by GLOBAL by_cuid index with no `orgId` arg to check
    // the result against. Widening as-is would let any agent read another org's
    // unit row by guessing/enumerating its cuid — see agentOps below.
    await requireService(ctx);
    return await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Units for ONE asset within an org (all statuses), via the
 * `by_organizationId_assetId_status` index — replaces a whole-org
 * `projectLineItemUnits.list` + JS `.filter(u => u.assetId === …)` on the
 * add-line-item double-booking check.
 */
export const listByOrgAndAsset = query({
  args: { orgId: v.string(), assetId: v.string() },
  handler: async (ctx, { orgId, assetId }) => {
    // Widened (Phase 5 domain slice, #1001): org-scoped via the composite index
    // itself (organizationId is a leading index key, not a post-hoc JS filter).
    await requireOrgPermission(ctx, orgId, "project", "read");
    return await ctx.db
      .query("projectLineItemUnits")
      .withIndex("by_organizationId_assetId_status", (q) => q.eq("organizationId", orgId).eq("assetId", assetId))
      .collect();
  },
});

export const listByLineItem = query({
  args: { lineItemId: v.string() },
  handler: async (ctx, { lineItemId }) => {
    // NOT widened: `by_lineItemId` is a GLOBAL index and this query takes no
    // `orgId` arg at all — there is nothing to check a caller-supplied
    // `lineItemId` against, so any agent could read another org's units by
    // guessing a foreign lineItemId. See agentOps below.
    await requireService(ctx);
    return await ctx.db
      .query("projectLineItemUnits")
      .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
      .collect();
  },
});

/**
 * Batch variant of {@link listByLineItem}: collect units for many line items in
 * one round-trip (N index scans, server-side). Feeds the Phase A line-item-tree
 * reconstruction (`src/lib/project-line-item-read.ts`) — a project's units are
 * fetched by its line-item ids rather than an org-wide collect. Service-only,
 * matching the rest of this module's reads.
 */
export const listByLineItemIds = query({
  args: { lineItemIds: v.array(v.string()) },
  handler: async (ctx, { lineItemIds }) => {
    // NOT widened: same gap as listByLineItem — no `orgId` arg, `by_lineItemId`
    // is global, so there's no way to check the caller's org against the ids
    // supplied. See agentOps below.
    await requireService(ctx);
    const out = [];
    for (const lineItemId of lineItemIds) {
      const rows = await ctx.db
        .query("projectLineItemUnits")
        .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId))
        .collect();
      out.push(...rows);
    }
    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    lineItemId: v.string(),
    ordinal: v.number(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    parentUnitAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    returnedQuantity: v.optional(v.number()),
    status: v.optional(enums.LineItemStatus),
    prepStatus: v.optional(enums.PrepStatus),
    prepContainer: v.optional(v.string()),
    checkedOutAt: v.optional(v.number()),
    checkedOutById: v.optional(v.string()),
    returnedAt: v.optional(v.number()),
    returnedById: v.optional(v.string()),
    returnCondition: v.optional(enums.ReturnCondition),
    returnStatus: v.optional(enums.ReturnStatus),
    returnNotes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectLineItemUnits", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    lineItemId: v.string(),
    ordinal: v.number(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    parentUnitAssetId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    returnedQuantity: v.optional(v.number()),
    status: v.optional(enums.LineItemStatus),
    prepStatus: v.optional(enums.PrepStatus),
    prepContainer: v.optional(v.string()),
    checkedOutAt: v.optional(v.number()),
    checkedOutById: v.optional(v.string()),
    returnedAt: v.optional(v.number()),
    returnedById: v.optional(v.string()),
    returnCondition: v.optional(enums.ReturnCondition),
    returnStatus: v.optional(enums.ReturnStatus),
    returnNotes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectLineItemUnits", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      lineItemId: v.optional(v.string()),
      ordinal: v.optional(v.number()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      parentUnitAssetId: v.optional(v.string()),
      quantity: v.optional(v.number()),
      returnedQuantity: v.optional(v.number()),
      status: v.optional(enums.LineItemStatus),
      prepStatus: v.optional(enums.PrepStatus),
      prepContainer: v.optional(v.string()),
      checkedOutAt: v.optional(v.number()),
      checkedOutById: v.optional(v.string()),
      returnedAt: v.optional(v.number()),
      returnedById: v.optional(v.string()),
      returnCondition: v.optional(enums.ReturnCondition),
      returnStatus: v.optional(enums.ReturnStatus),
      returnNotes: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectLineItemUnits not found: " + id);
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
    const doc = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectLineItemUnits not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all project line item units (fulfillment/serial rows) for an org.", danger: "low", mcpTier: 2 },
  listByOrgAndAsset: { summary: "List an asset's line-item units within an org, for double-booking checks.", danger: "low", mcpTier: 3 },
  getById: { agentAccess: "denied", reason: "Point-read by global by_cuid with no orgId arg to verify the result against — would let an agent read another org's unit by guessing its cuid." },
  listByLineItem: { agentAccess: "denied", reason: "by_lineItemId is a global index and the query takes no orgId arg, so a caller-supplied lineItemId can't be checked against the caller's org." },
  listByLineItemIds: { agentAccess: "denied", reason: "Same gap as listByLineItem: no orgId arg to check the (global, cross-org) lineItemIds against." },
};
