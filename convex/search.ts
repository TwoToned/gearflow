import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Phase 7 — native reactive search over the `searchIndex`es added in schema.ts.
 *
 * These replace the "load the whole org table into the browser, then JS-filter"
 * pattern behind the searchable pickers/tables. Each query:
 *   - is org-scoped (`requireOrgRead`, browser-callable with a user token, same
 *     as the `list` queries the pickers already subscribe to),
 *   - returns a BOUNDED result set (never a whole-table `.collect()`), keeping it
 *     within Convex read limits on large tenants,
 *   - is reactive — a new matching row appears without a refetch.
 *
 * Empty query → a bounded most-recent list via the org index (so an unfocused
 * picker still shows something), NOT the whole table.
 *
 * Kept in this hand-written module (NOT the generated `models.ts`/`assets.ts`
 * CRUD files) so the CRUD generator never clobbers it.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
}

export const models = query({
  args: { orgId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, query: term, limit }) => {
    await requireOrgRead(ctx, orgId);
    const take = clampLimit(limit);
    const q = term.trim();
    if (!q) {
      return await ctx.db
        .query("models")
        .withIndex("by_organizationId", (x) => x.eq("organizationId", orgId))
        .order("desc")
        .take(take);
    }
    return await ctx.db
      .query("models")
      .withSearchIndex("search_name", (s) =>
        s.search("name", q).eq("organizationId", orgId),
      )
      .take(take);
  },
});

export const kits = query({
  args: { orgId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, query: term, limit }) => {
    await requireOrgRead(ctx, orgId);
    const take = clampLimit(limit);
    const q = term.trim();
    if (!q) {
      return await ctx.db
        .query("kits")
        .withIndex("by_organizationId", (x) => x.eq("organizationId", orgId))
        .order("desc")
        .take(take);
    }
    return await ctx.db
      .query("kits")
      .withSearchIndex("search_name", (s) =>
        s.search("name", q).eq("organizationId", orgId),
      )
      .take(take);
  },
});

export const clients = query({
  args: { orgId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, query: term, limit }) => {
    await requireOrgRead(ctx, orgId);
    const take = clampLimit(limit);
    const q = term.trim();
    if (!q) {
      return await ctx.db
        .query("clients")
        .withIndex("by_organizationId", (x) => x.eq("organizationId", orgId))
        .order("desc")
        .take(take);
    }
    return await ctx.db
      .query("clients")
      .withSearchIndex("search_name", (s) =>
        s.search("name", q).eq("organizationId", orgId),
      )
      .take(take);
  },
});

export const suppliers = query({
  args: { orgId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, query: term, limit }) => {
    await requireOrgRead(ctx, orgId);
    const take = clampLimit(limit);
    const q = term.trim();
    if (!q) {
      return await ctx.db
        .query("suppliers")
        .withIndex("by_organizationId", (x) => x.eq("organizationId", orgId))
        .order("desc")
        .take(take);
    }
    return await ctx.db
      .query("suppliers")
      .withSearchIndex("search_name", (s) =>
        s.search("name", q).eq("organizationId", orgId),
      )
      .take(take);
  },
});

export const projects = query({
  args: {
    orgId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
    includeTemplates: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, query: term, limit, includeTemplates }) => {
    await requireOrgRead(ctx, orgId);
    const take = clampLimit(limit);
    const q = term.trim();
    // isTemplate is optional (often undefined for real projects), so filter it in
    // JS on the bounded result set rather than via the search filterField, which
    // would only match rows where the field is explicitly present.
    const keep = (p: { isTemplate?: boolean }) => includeTemplates || !p.isTemplate;
    if (!q) {
      const rows = await ctx.db
        .query("projects")
        .withIndex("by_organizationId", (x) => x.eq("organizationId", orgId))
        .order("desc")
        .take(take * 2);
      return rows.filter(keep).slice(0, take);
    }
    const rows = await ctx.db
      .query("projects")
      .withSearchIndex("search_name", (s) =>
        s.search("name", q).eq("organizationId", orgId),
      )
      .take(take * 2);
    return rows.filter(keep).slice(0, take);
  },
});

/**
 * Assets search matches EITHER asset tag OR serial number (two search indexes),
 * merged + deduped, so one picker search box covers both — relevance order is
 * assetTag hits first, then serial hits.
 */
export const assets = query({
  args: { orgId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, query: term, limit }) => {
    await requireOrgRead(ctx, orgId);
    const take = clampLimit(limit);
    const q = term.trim();
    if (!q) {
      return await ctx.db
        .query("assets")
        .withIndex("by_organizationId", (x) => x.eq("organizationId", orgId))
        .order("desc")
        .take(take);
    }
    const byTag = await ctx.db
      .query("assets")
      .withSearchIndex("search_assetTag", (s) =>
        s.search("assetTag", q).eq("organizationId", orgId),
      )
      .take(take);
    const bySerial = await ctx.db
      .query("assets")
      .withSearchIndex("search_serialNumber", (s) =>
        s.search("serialNumber", q).eq("organizationId", orgId),
      )
      .take(take);
    const seen = new Set(byTag.map((a) => a._id));
    const merged = [...byTag];
    for (const a of bySerial) {
      if (!seen.has(a._id)) {
        seen.add(a._id);
        merged.push(a);
      }
    }
    return merged.slice(0, take);
  },
});
