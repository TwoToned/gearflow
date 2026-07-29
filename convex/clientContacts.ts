import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for ClientContact (Convex table "clientContacts"). GENERATED — mirrors
 * the modelBulkAccessories.ts shape (WS9 #948).
 *
 * AUTH: mutations require the trusted backend SERVICE token (service-only
 * mirror/read helpers; the browser-direct write path with RBAC + validation + audit
 * enforced inside Convex lives in clientContactWrites.ts — see FEATUREDOCS/54).
 * Reads are service-only (not on the browser-readable allowlist — the client
 * `detail` query embeds contacts directly). Lookups use the cuid (`id`) via
 * by_cuid. See FEATUREDOCS/54.
 */

export const agentOps: AgentOpsAnnotations = {
  forClient: { summary: "List a client's contacts for the org.", danger: "low", mcpTier: 2 },
};

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    clientId: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("clientContacts", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    clientId: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("clientContacts", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      clientId: v.optional(v.string()),
      name: v.optional(v.string()),
      role: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      notes: v.optional(v.string()),
      isPrimary: v.optional(v.boolean()),
      sortOrder: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("clientContacts not found: " + id);
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
    const doc = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("clientContacts not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * All of an org's contacts (service-only) — used by WooCommerce matching
 * (src/server/woocommerce.ts) to build a per-client contact map in one round trip
 * instead of N per-client reads.
 */
export const listByOrg = query({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("clientContacts")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)) // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

/** All contacts for a client + org, sorted by sortOrder (primary first, in practice). */
export const listByClientId = query({
  args: { clientId: v.string(), organizationId: v.string() },
  handler: async (ctx, { clientId, organizationId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .filter((q) => q.eq(q.field("organizationId"), organizationId))
      .collect();
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return rows;
  },
});

/**
 * Browser-callable twin of `listByClientId`, org-scoped via `requireOrgRead`
 * instead of the service token — powers the project wizard / project sidebar
 * contact picker (WS9 #948), which needs a given client's contacts reactively
 * without going through the client `detail` composite.
 */
export const forClient = query({
  args: { clientId: v.string(), orgId: v.string() },
  handler: async (ctx, { clientId, orgId }) => {
    await requireOrgReadFor(ctx, orgId, "client"); // Phase 2 read bootstrap (#998)
    const rows = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .collect();
    return rows
      .filter((r) => r.organizationId === orgId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  },
});
