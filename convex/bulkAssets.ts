import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadFor, requireOrgReadDocFor, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import { adjustBulkAvailability } from "./lib/inventory";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for BulkAsset (Convex table "bulkAssets"). GENERATED — Phase 2/5.
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
    await requireOrgReadFor(ctx, orgId, "bulkAsset"); // Phase 2 read bootstrap (#998)
    return await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: deliberate reactive full-org read (perf-convex-efficiency-2026-06.md); accepted R-9.8 tradeoff for live updates — revisit with paginated reactivity if per-org rows grow large — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "bulkAsset"); // Phase 2 read bootstrap (#998)
    return doc;
  },
});

const BULK_STATUS_RANK: Record<string, number> = { ACTIVE: 0, LOW_STOCK: 1, OUT_OF_STOCK: 2, RETIRED: 3 };

/**
 * Paginated BULK-ASSET list — browser-native replacement for the getBulkAssets
 * server action. Fetches the org's bulk assets (by_organizationId) + model/location
 * maps, then filters/sorts/paginates in JS (parity with filterBulkAssets/sortBulkAssets/
 * paginate). Each row carries its model (with category) + location. Two consumers: the
 * T&T-new picker (one-shot, non-reactive) and AssetTable's bulk view (live, via
 * useAuthedQuery — see docs/designs/perf-convex-efficiency-2026-06.md Finding #1).
 */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(v.string()),
    locationId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgRead(ctx, a.orgId);
    const isActive = a.isActive ?? true;
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    const sortBy = a.sortBy ?? "assetTag";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;

    const [rows, models, categories, locations] = await Promise.all([
      ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: server-side filter/sort/paginate over the org set (perf design); accepted R-9.8 tradeoff — see docs/exceptions.md R-8.3.3
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
      ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(), // r9.8-ok: bounded per-org catalog/config map (list enrichment) — see docs/exceptions.md R-8.3.3
    ]);
    const modelMap = new Map(models.map((m) => [m.id, m]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const modelNameFor = (id: string) => modelMap.get(id)?.name;
    const categoryFor = (id: string) => modelMap.get(id)?.categoryId;
    const locationNameFor = (id: string | null) => (id ? locationMap.get(id)?.name : null);

    const filtered = rows.filter((b) => {
      if ((b.isActive ?? true) !== isActive) return false;
      if (a.status && (b.status ?? "ACTIVE") !== a.status) return false;
      if (a.locationId && (b.locationId ?? null) !== a.locationId) return false;
      if (a.modelId && b.modelId !== a.modelId) return false;
      if (a.categoryId && categoryFor(b.modelId) !== a.categoryId) return false;
      if (a.search && !matchesSearch([b.assetTag, modelNameFor(b.modelId)], a.search)) return false;
      return true;
    });
    const keyFn = (b: typeof rows[number]): unknown => {
      if (sortBy === "model") return modelNameFor(b.modelId);
      if (sortBy === "location") return locationNameFor(b.locationId ?? null);
      if (sortBy === "status") return BULK_STATUS_RANK[b.status ?? "ACTIVE"];
      return (b as unknown as Record<string, unknown>)[sortBy];
    };
    const sorted = [...filtered].sort((x, y) => compareValues(keyFn(x), keyFn(y), dir));
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);

    const bulkAssets = pageRows.map((b) => {
      const model = modelMap.get(b.modelId) ?? null;
      return {
        id: b.id,
        organizationId: b.organizationId,
        modelId: b.modelId,
        assetTag: b.assetTag,
        totalQuantity: b.totalQuantity ?? 0,
        availableQuantity: b.availableQuantity ?? 0,
        purchasePricePerUnit: b.purchasePricePerUnit ?? null,
        locationId: b.locationId ?? null,
        status: b.status ?? "ACTIVE",
        notes: b.notes ?? null,
        tags: b.tags ?? [],
        isActive: b.isActive ?? true,
        model: model ? { ...model, category: model.categoryId ? categoryMap.get(model.categoryId) ?? null : null } : null,
        location: b.locationId ? locationMap.get(b.locationId) ?? null : null,
      };
    });

    return { bulkAssets, total, page, pageSize, totalPages };
  },
});

/**
 * Single BULK-ASSET (mapped scalars) — browser-native replacement for the
 * getBulkAsset server action. Returns null for a missing/wrong-org row (parity
 * with the old `serialize(null)`). The only consumer (registry detail) reads
 * modelId + existence to redirect to the model page, so the heavy lineItems/
 * scanLogs/testTagAssets composite the old action built is dropped (unused).
 */
export const detail = query({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId) return null; // graceful not-found / wrong-org (parity)
    return {
      id: doc.id,
      organizationId: doc.organizationId,
      modelId: doc.modelId,
      assetTag: doc.assetTag,
      totalQuantity: doc.totalQuantity ?? 0,
      availableQuantity: doc.availableQuantity ?? 0,
      locationId: doc.locationId ?? null,
      status: doc.status ?? "ACTIVE",
      notes: doc.notes ?? null,
      tags: doc.tags ?? [],
      isActive: doc.isActive ?? true,
    };
  },
});

export const getByAssetTag = query({
  args: { organizationId: v.string(), assetTag: v.string() },
  handler: async (ctx, { organizationId, assetTag }) => {
    await requireOrgRead(ctx, organizationId);
    return await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", organizationId).eq("assetTag", assetTag))
      .unique();
  },
});

export const listByModel = query({
  args: { modelId: v.string(), orgId: v.string() },
  handler: async (ctx, { modelId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    // by_modelId is a GLOBAL index — filter to the caller's org (cross-tenant guard).
    return (await ctx.db
      .query("bulkAssets")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .collect()).filter((r) => r.organizationId === orgId);
  },
});

/**
 * Batch the per-model `by_modelId` scans for MANY models into ONE round-trip —
 * the bulk-asset counterpart of assets.listByModelIds, killing the per-model N+1
 * in availability. Deduped + capped; org-filtered.
 */
export const listByModelIds = query({
  args: { orgId: v.string(), modelIds: v.array(v.string()) },
  handler: async (ctx, { orgId, modelIds }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(modelIds)];
    if (unique.length > 1000) throw new ConvexError("bulkAssets.listByModelIds: too many modelIds (max 1000)");
    const groups = await Promise.all(
      unique.map((mid) => ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect()),
    );
    return groups.flat().filter((b) => b.organizationId === orgId);
  },
});

/**
 * Batch point-read bulk assets by cuid, scoped to one org — the bulk-asset
 * counterpart of assets.listByIds, so a detail composite reads only its members
 * instead of getBulkAssetsByOrg. Cross-org ids are dropped.
 */
export const listByIds = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("bulkAssets.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    return docs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    totalQuantity: v.optional(v.number()),
    availableQuantity: v.optional(v.number()),
    purchasePricePerUnit: v.optional(v.number()),
    locationId: v.optional(v.string()),
    status: v.optional(enums.BulkAssetStatus),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const _id = await ctx.db.insert("bulkAssets", args);
    await bumpCountersForTable(ctx, "bulkAssets", null, args);
    return _id;
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    totalQuantity: v.optional(v.number()),
    availableQuantity: v.optional(v.number()),
    purchasePricePerUnit: v.optional(v.number()),
    locationId: v.optional(v.string()),
    status: v.optional(enums.BulkAssetStatus),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("bulkAssets", args);
    await bumpCountersForTable(ctx, "bulkAssets", null, args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      totalQuantity: v.optional(v.number()),
      availableQuantity: v.optional(v.number()),
      purchasePricePerUnit: v.optional(v.number()),
      locationId: v.optional(v.string()),
      status: v.optional(enums.BulkAssetStatus),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("bulkAssets not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    await bumpCountersForTable(ctx, "bulkAssets", doc, { ...doc, ...safePatch });
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("bulkAssets not found: " + id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "bulkAssets", doc, null);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core mega-flip) — re-add on regen ──────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const NEVER_CLEAR = new Set(["id", "organizationId", "modelId", "assetTag"]);

/**
 * Clear-to-null patch (the crewMembers.patchMember pattern): `set` applies values,
 * every field name in `clear[]` is removed from the doc (the generated `update`
 * can't unset an optional field — toConvexDoc drops nulls before the wire).
 */
export const patchBulkAsset = mutation({
  args: {
    id: v.string(),
    set: v.object({
      modelId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      totalQuantity: v.optional(v.number()),
      availableQuantity: v.optional(v.number()),
      purchasePricePerUnit: v.optional(v.number()),
      locationId: v.optional(v.string()),
      status: v.optional(enums.BulkAssetStatus),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      updatedAt: v.optional(v.number()),
    }),
    clear: v.array(v.string()),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("bulkAssets not found: " + id);
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set);
      await bumpCountersForTable(ctx, "bulkAssets", doc, { ...doc, ...set });
      return doc._id;
    }
    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = { ...rest, ...set };
    for (const k of clear) {
      if (NEVER_CLEAR.has(k)) continue;
      delete merged[k];
    }
    await ctx.db.replace(doc._id, merged as typeof rest);
    await bumpCountersForTable(ctx, "bulkAssets", doc, merged);
    return doc._id;
  },
});

/**
 * Atomic availability adjustment(s) — the kit/accessory checkout primitive.
 * delta<0 consumes (guarded), delta>0 releases. Throws ConvexError (rolls the
 * mutation back) on insufficient stock / cross-org / missing. See lib/inventory.ts.
 */
export const adjustAvailability = mutation({
  args: {
    organizationId: v.string(),
    adjustments: v.array(v.object({ bulkAssetId: v.string(), delta: v.number() })),
  },
  handler: async (ctx, { organizationId, adjustments }) => {
    await requireService(ctx);
    await adjustBulkAvailability(ctx, organizationId, adjustments);
  },
});
