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

/**
 * Models search matches EITHER name OR manufacturer (two search indexes), merged +
 * deduped — the picker label is "{manufacturer} {name}", so a manufacturer term must
 * match too. Name hits rank first, then manufacturer-only hits (mirrors the assets
 * assetTag+serialNumber merge).
 */
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
    const byName = await ctx.db
      .query("models")
      .withSearchIndex("search_name", (s) => s.search("name", q).eq("organizationId", orgId))
      .take(take);
    const byManufacturer = await ctx.db
      .query("models")
      .withSearchIndex("search_manufacturer", (s) => s.search("manufacturer", q).eq("organizationId", orgId))
      .take(take);
    const seen = new Set(byName.map((m) => m._id));
    const merged = [...byName];
    for (const m of byManufacturer) {
      if (!seen.has(m._id)) {
        seen.add(m._id);
        merged.push(m);
      }
    }
    return merged.slice(0, take);
  },
});

/**
 * Kits search matches EITHER name OR assetTag (two search indexes), merged + deduped
 * — the picker label is "{assetTag} - {name}", so a tag term must match too. Excludes
 * prep kits by default (`includePrep`), mirroring getKits' active + non-prep default;
 * prep exclusion is a search filterField (kits carry `isPrep`).
 */
export const kits = query({
  args: {
    orgId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
    includePrep: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, query: term, limit, includePrep }) => {
    await requireOrgRead(ctx, orgId);
    const take = clampLimit(limit);
    const q = term.trim();
    // isPrep is optional (often undefined for normal kits), so a `.eq("isPrep", false)`
    // filterField would miss undefined rows. Filter in JS on the bounded result set.
    const keep = (k: { isPrep?: boolean }) => includePrep || !k.isPrep;
    if (!q) {
      const rows = await ctx.db
        .query("kits")
        .withIndex("by_organizationId", (x) => x.eq("organizationId", orgId))
        .order("desc")
        .take(take * 2);
      return rows.filter(keep).slice(0, take);
    }
    const byName = await ctx.db
      .query("kits")
      .withSearchIndex("search_name", (s) => s.search("name", q).eq("organizationId", orgId))
      .take(take * 2);
    const byTag = await ctx.db
      .query("kits")
      .withSearchIndex("search_assetTag", (s) => s.search("assetTag", q).eq("organizationId", orgId))
      .take(take * 2);
    const seen = new Set(byName.map((k) => k._id));
    const merged = [...byName];
    for (const k of byTag) {
      if (!seen.has(k._id)) {
        seen.add(k._id);
        merged.push(k);
      }
    }
    return merged.filter(keep).slice(0, take);
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

// NOTE: `projects` and `assets` search queries were removed (2026-07-07). Neither had
// a single-select picker to consume them: the app never picks a project (projects are
// created/edited, never selected in a combobox), and every asset consumer is a
// MULTI-select builder/table (maintenance form, asset table) whose selected-row chips
// need per-id label resolution the bounded search page can't provide. Their search
// indexes were dropped from schema.ts too — re-add both (query + index) alongside a
// real single-select consumer when one is built. See docs/designs/convex-native-read-layer.md.
