import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgReadFor, requireOrgReadDocFor, requireService } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for CustomFieldDefinition (Convex table "customFieldDefinitions"). GENERATED — Phase 2/5.
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
    await requireOrgReadFor(ctx, orgId, "orgSettings"); // Phase 5 domain slice (#1001)
    return await ctx.db
      .query("customFieldDefinitions")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: small bounded per-org config set — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("customFieldDefinitions").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "orgSettings"); // Phase 5 domain slice (#1001)
    return doc;
  },
});

/**
 * Agent-op annotations (Phase 5, #1001). Custom field definitions are org-wide
 * config (field labels/types/options per entity type) — modeled as `orgSettings`
 * for both reads, matching the resource used at the guard call sites above.
 */
export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List custom field definitions for the org.", danger: "low", mcpTier: 2 },
  getById: { summary: "Get one custom field definition by id.", danger: "low", mcpTier: 3 },
};

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    entityType: v.optional(enums.CustomFieldEntity),
    label: v.string(),
    fieldKey: v.string(),
    fieldType: v.optional(enums.CustomFieldType),
    options: v.optional(v.array(v.string())),
    required: v.optional(v.boolean()),
    helpText: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("customFieldDefinitions", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    entityType: v.optional(enums.CustomFieldEntity),
    label: v.string(),
    fieldKey: v.string(),
    fieldType: v.optional(enums.CustomFieldType),
    options: v.optional(v.array(v.string())),
    required: v.optional(v.boolean()),
    helpText: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("customFieldDefinitions").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("customFieldDefinitions", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      entityType: v.optional(enums.CustomFieldEntity),
      label: v.optional(v.string()),
      fieldKey: v.optional(v.string()),
      fieldType: v.optional(enums.CustomFieldType),
      options: v.optional(v.array(v.string())),
      required: v.optional(v.boolean()),
      helpText: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("customFieldDefinitions").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("customFieldDefinitions not found: " + id);
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
    const doc = await ctx.db.query("customFieldDefinitions").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("customFieldDefinitions not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Atomic drag-reorder: assign each definition's sortOrder in ONE mutation round-trip
 * (was a server-side `Promise.all` firing one getById + one update per row = 2N calls).
 * Explicit {id, sortOrder} pairs (not array-index) so the caller can filter foreign/
 * unresolved ids without compressing the survivors' positions. Per-item org re-check:
 * by_cuid is a GLOBAL index, so the `doc.organizationId === orgId` skip stops a caller
 * reordering another org's definitions (mirrors modelCheckItems.reorderMany).
 */
export const reorderMany = mutation({
  args: {
    orgId: v.string(),
    items: v.array(v.object({ id: v.string(), sortOrder: v.number() })),
    now: v.number(),
  },
  handler: async (ctx, { orgId, items, now }) => {
    await requireService(ctx);
    for (const it of items) {
      const doc = await ctx.db.query("customFieldDefinitions").withIndex("by_cuid", (q) => q.eq("id", it.id)).unique();
      if (doc && doc.organizationId === orgId) await ctx.db.patch(doc._id, { sortOrder: it.sortOrder, updatedAt: now }); // per-item org re-check
    }
  },
});
