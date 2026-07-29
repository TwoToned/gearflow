import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgReadFor, requireOrgReadDocFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for NotificationEmailLog (Convex table "notificationEmailLogs"). GENERATED — Phase 2/5.
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
    await requireOrgReadFor(ctx, orgId, "orgSettings"); // Phase 5 domain slice (#1001) — sent-email audit trail is org config/observability, no separate resource fits
    return await ctx.db
      .query("notificationEmailLogs")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("notificationEmailLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "orgSettings"); // Phase 5 domain slice (#1001)
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    notificationKey: v.string(),
    sentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("notificationEmailLogs", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    notificationKey: v.string(),
    sentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("notificationEmailLogs").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("notificationEmailLogs", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      userId: v.optional(v.string()),
      notificationKey: v.optional(v.string()),
      sentAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("notificationEmailLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("notificationEmailLogs not found: " + id);
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
    const doc = await ctx.db.query("notificationEmailLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("notificationEmailLogs not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Agent-op annotations (Phase 5, #1001). Widened per triage — rows store
 * `userId` (not a raw email address) + `notificationKey` + `sentAt`, no
 * greater PII exposure than what's already visible via `members`. FLAG FOR A
 * SECOND LOOK: this is a delivery-timing audit trail (who got notified, when)
 * — if a future `notificationKey` embeds something more sensitive, revisit.
 */
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List the org's sent-notification-email audit trail.", danger: "low", mcpTier: 3 },
  getById: { summary: "Get one sent-notification-email log entry by id.", danger: "low", mcpTier: 3 },
};
