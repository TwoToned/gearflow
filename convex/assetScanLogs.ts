import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgPermission, requireOrgReadDocFor } from "./lib/auth";
import { collectCapped } from "./lib/pagination";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for AssetScanLog (Convex table "assetScanLogs"). GENERATED — Phase 2/5.
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
    await requireOrgPermission(ctx, orgId, "asset", "read"); // Phase 5 domain slice (#1001) — org-scoped via by_organizationId
    // r9.8-ok: sole caller (getScanLog's no-filter fallback) needs the org's full
    // set to sort by scannedAt desc and slice an arbitrary page number (not a
    // forward-only cursor) — capped, not a bare collect — see docs/exceptions.md R-8.3.3
    const { rows } = await collectCapped(
      ctx.db.query("assetScanLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)),
    );
    return rows;
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    // No orgId arg — this is a doc-fetch shape (mirrors assets.getById), so the org
    // check is against the fetched doc + the caller's own token org, not a param.
    const doc = await ctx.db.query("assetScanLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "asset"); // Phase 5 domain slice (#1001)
    return doc;
  },
});

/** List scan logs for a project (paginator/scan-log view). Filters org in JS since there's no composite index. */
export const listByProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgPermission(ctx, orgId, "asset", "read"); // Phase 5 domain slice (#1001) — result is JS-filtered to this orgId below
    const rows = await ctx.db
      .query("assetScanLogs")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/**
 * Scan logs for ONE kit (via by_kitId), org-filtered. Replaces the org-wide
 * assetScanLogs.list + JS `.filter(kitId === id)` in the getKit composite. Returns
 * raw rows; ordering/limit (scannedAt desc, take 20) stays in the caller.
 */
export const listByKitId = query({
  args: { orgId: v.string(), kitId: v.string() },
  handler: async (ctx, { orgId, kitId }) => {
    await requireOrgPermission(ctx, orgId, "asset", "read"); // Phase 5 domain slice (#1001) — result is JS-filtered to this orgId below
    const rows = await ctx.db
      .query("assetScanLogs")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/** List scan logs for a single asset within an org. */
export const listByOrgAndAsset = query({
  args: { orgId: v.string(), assetId: v.string() },
  handler: async (ctx, { orgId, assetId }) => {
    await requireOrgPermission(ctx, orgId, "asset", "read"); // Phase 5 domain slice (#1001) — result is JS-filtered to this orgId below
    const rows = await ctx.db
      .query("assetScanLogs")
      .withIndex("by_assetId", (q) => q.eq("assetId", assetId))
      .collect();
    return rows.filter((r) => r.organizationId === orgId);
  },
});

/** List scan logs for a user (for user-delete cascade). NOT org-scoped by design (see agentOps denial below). */
export const listByScannedById = query({
  args: { scannedById: v.string() },
  handler: async (ctx, { scannedById }) => {
    await requireService(ctx);
    return await ctx.db
      .query("assetScanLogs")
      .withIndex("by_scannedById", (q) => q.eq("scannedById", scannedById))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    action: enums.ScanAction,
    scannedById: v.string(),
    scannedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("assetScanLogs", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    action: enums.ScanAction,
    scannedById: v.string(),
    scannedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("assetScanLogs").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("assetScanLogs", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      action: v.optional(enums.ScanAction),
      scannedById: v.optional(v.string()),
      scannedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
      location: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assetScanLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assetScanLogs not found: " + id);
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
    const doc = await ctx.db.query("assetScanLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assetScanLogs not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List an org's asset scan-log history.", danger: "low", mcpTier: 3 },
  getById: { summary: "Get one scan-log entry by id.", danger: "low", mcpTier: 3 },
  listByProject: { summary: "List scan-log entries for one project.", danger: "low", mcpTier: 3 },
  listByKitId: { summary: "List scan-log entries for one kit.", danger: "low", mcpTier: 3 },
  listByOrgAndAsset: { summary: "List scan-log entries for one asset.", danger: "low", mcpTier: 3 },
  listByScannedById: {
    agentAccess: "denied",
    reason: "Cross-org GDPR-cascade lookup by scannedById with no org filter at all (not org-scoped even in JS) — an internal user-delete helper, not a real read surface.",
  },
};
