import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission, requireOrgReadDocFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for LineItemMergeMap (Convex table "lineItemMergeMaps"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54).
 * WRITES stay SERVICE-only — this table is only ever written by the line-item-merge
 * server-side flow, never directly by a browser or agent caller.
 *
 * READS (Phase 5 domain slice, #1001) are WIDENED: a merge-map row is a plain
 * org-scoped audit record (which line item a checked-out unit's history moved to
 * after a merge) with no sensitivity beyond ordinary project data, so `list` uses
 * `requireOrgPermission(ctx, orgId, "project", "read")` and `getById` uses
 * `requireOrgReadDocFor(ctx, doc, "project")` — the same bar as any other
 * project-scoped read. Lookups use the cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    return await ctx.db
      .query("lineItemMergeMaps")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("lineItemMergeMaps").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "project");
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    oldLineItemId: v.string(),
    canonicalLineItemId: v.string(),
    movedUnitId: v.optional(v.string()),
    checkRecordsRepointed: v.optional(v.number()),
    serviceRepointed: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    mergedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("lineItemMergeMaps", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    oldLineItemId: v.string(),
    canonicalLineItemId: v.string(),
    movedUnitId: v.optional(v.string()),
    checkRecordsRepointed: v.optional(v.number()),
    serviceRepointed: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    mergedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("lineItemMergeMaps").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("lineItemMergeMaps", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      oldLineItemId: v.optional(v.string()),
      canonicalLineItemId: v.optional(v.string()),
      movedUnitId: v.optional(v.string()),
      checkRecordsRepointed: v.optional(v.number()),
      serviceRepointed: v.optional(v.boolean()),
      notes: v.optional(v.string()),
      mergedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("lineItemMergeMaps").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("lineItemMergeMaps not found: " + id);
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
    const doc = await ctx.db.query("lineItemMergeMaps").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("lineItemMergeMaps not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
// Only the two WIDENED queries are annotated — the mutations stay SERVICE-only
// (structurally unreachable from the API/MCP surface; requireService admits no
// agent token, see convex/agentServiceUnreachable.test.ts) and are intentionally
// left unannotated.
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List an org's line-item merge history records.", danger: "low", mcpTier: 3 },
  getById: { summary: "Get one line-item merge history record by id.", danger: "low", mcpTier: 3 },
};
