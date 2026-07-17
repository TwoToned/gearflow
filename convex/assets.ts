import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { bumpCountersForTable } from "./lib/counters";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Asset (Convex table "assets"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 *
 * COUNTER MAINTENANCE (§3.6): the mutating funcs keep the dashboardCounters row in
 * sync in-transaction via bumpCountersForTable (convex/lib/counters.ts). Emitted by
 * the generator for the five counted tables — re-add on regen. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

const A_STATUS_RANK: Record<string, number> = { AVAILABLE: 0, CHECKED_OUT: 1, IN_MAINTENANCE: 2, RETIRED: 3, LOST: 4, RESERVED: 5 };
const A_CONDITION_RANK: Record<string, number> = { NEW: 0, GOOD: 1, FAIR: 2, POOR: 3, DAMAGED: 4 };
function aMatchesSearch(hs: (string | null | undefined)[], search: string): boolean {
  const n = search.toLowerCase();
  return hs.some((h) => (h ?? "").toLowerCase().includes(n));
}
function aCompare(av: unknown, bv: unknown, dir: 1 | -1): number {
  const aN = av == null, bN = bv == null;
  if (aN && bN) return 0;
  if (aN) return dir === 1 ? 1 : -1;
  if (bN) return dir === 1 ? -1 : 1;
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
  if (typeof av === "boolean" && typeof bv === "boolean") return ((av ? 1 : 0) - (bv ? 1 : 0)) * dir;
  return String(av).localeCompare(String(bv)) * dir;
}

/**
 * Paginated ASSET list — browser-native replacement for the getAssets server action.
 * Fetches the org's assets + model(with category)/location maps, then filters/sorts/
 * paginates in JS (parity with filterAssets/sortAssets/paginate). One-shot (the only
 * consumer — the T&T-new picker — reads it non-reactively).
 */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(v.string()),
    condition: v.optional(v.string()),
    locationId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    statusIn: v.optional(v.array(v.string())),
    conditionIn: v.optional(v.array(v.string())),
    locationIdIn: v.optional(v.array(v.string())),
    categoryIdIn: v.optional(v.array(v.string())),
    tagsHasSome: v.optional(v.array(v.string())),
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
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
    ]);
    const modelMap = new Map(models.map((m) => [m.id, m]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const modelNameFor = (id: string) => modelMap.get(id)?.name;
    const categoryFor = (id: string) => modelMap.get(id)?.categoryId;
    const locationNameFor = (id: string | null) => (id ? locationMap.get(id)?.name : null);

    const filtered = rows.filter((r) => {
      const status = r.status ?? "AVAILABLE";
      const condition = r.condition ?? "GOOD";
      if ((r.isActive ?? true) !== isActive) return false;
      if (a.status && status !== a.status) return false;
      if (a.condition && condition !== a.condition) return false;
      if (a.locationId && (r.locationId ?? null) !== a.locationId) return false;
      if (a.modelId && r.modelId !== a.modelId) return false;
      if (a.categoryId && categoryFor(r.modelId) !== a.categoryId) return false;
      if (a.statusIn && a.statusIn.length > 0 && !a.statusIn.includes(status)) return false;
      if (a.conditionIn && a.conditionIn.length > 0 && !a.conditionIn.includes(condition)) return false;
      if (a.locationIdIn && a.locationIdIn.length > 0 && !(r.locationId != null && a.locationIdIn.includes(r.locationId))) return false;
      if (a.categoryIdIn && a.categoryIdIn.length > 0) { const cat = categoryFor(r.modelId); if (!(cat != null && a.categoryIdIn.includes(cat))) return false; }
      if (a.tagsHasSome && a.tagsHasSome.length > 0 && !(r.tags ?? []).some((t) => a.tagsHasSome!.includes(t))) return false;
      if (a.search && !aMatchesSearch([r.assetTag, r.serialNumber, r.customName, modelNameFor(r.modelId)], a.search)) return false;
      return true;
    });
    const total = filtered.length;
    const keyFn = (r: typeof rows[number]): unknown => {
      if (sortBy === "model") return modelNameFor(r.modelId);
      if (sortBy === "location") return locationNameFor(r.locationId ?? null);
      if (sortBy === "status") return A_STATUS_RANK[r.status ?? "AVAILABLE"];
      if (sortBy === "condition") return A_CONDITION_RANK[r.condition ?? "GOOD"];
      return (r as unknown as Record<string, unknown>)[sortBy];
    };
    const sorted = [...filtered].sort((x, y) => aCompare(keyFn(x), keyFn(y), dir));
    const pageRows = sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    const assets = pageRows.map((r) => {
      const model = modelMap.get(r.modelId) ?? null;
      return {
        ...r,
        model: model ? { ...model, category: model.categoryId ? categoryMap.get(model.categoryId) ?? null : null } : null,
        location: r.locationId ? locationMap.get(r.locationId) ?? null : null,
      };
    });
    return { assets, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },
});

/**
 * Primary-photo maps for the asset registry table + gallery — browser-native
 * replacement for getAssetRegistryPhotos. Returns { assetPhotos, modelPhotos }:
 * each id → { url, thumbnailUrl } of its PHOTO+isPrimary media row's file (org-scoped).
 */
export const registryPhotos = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    type Photo = { url: string | null; thumbnailUrl: string | null };
    const build = async (table: "assetMedia" | "modelMedia", fk: "assetId" | "modelId"): Promise<Record<string, Photo>> => {
      const out: Record<string, Photo> = {};
      const rows = await ctx.db.query(table).withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();
      for (const m of rows) {
        if (m.type !== "PHOTO" || !m.isPrimary) continue;
        const parentId = (m as Record<string, unknown>)[fk] as string;
        const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).unique();
        const resolved = file && file.organizationId === orgId ? file : null;
        out[parentId] = { url: resolved?.url ?? null, thumbnailUrl: resolved?.thumbnailUrl ?? null };
      }
      return out;
    };
    const [assetPhotos, modelPhotos] = await Promise.all([build("assetMedia", "assetId"), build("modelMedia", "modelId")]);
    return { assetPhotos, modelPhotos };
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const getByAssetTag = query({
  args: { organizationId: v.string(), assetTag: v.string() },
  handler: async (ctx, { organizationId, assetTag }) => {
    await requireOrgRead(ctx, organizationId);
    return await ctx.db
      .query("assets")
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
      .query("assets")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .collect()).filter((r) => r.organizationId === orgId);
  },
});

/**
 * Batch the per-model `by_modelId` scans for MANY models into ONE round-trip.
 * Replaces an N+1 of N separate `listByModel` calls (e.g. availability computes
 * stock per model across a projects view). Deduped + capped; org-filtered.
 */
export const listByModelIds = query({
  args: { orgId: v.string(), modelIds: v.array(v.string()) },
  handler: async (ctx, { orgId, modelIds }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(modelIds)];
    if (unique.length > 1000) throw new ConvexError("assets.listByModelIds: too many modelIds (max 1000)");
    const groups = await Promise.all(
      unique.map((mid) => ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect()),
    );
    return groups.flat().filter((a) => a.organizationId === orgId);
  },
});

/**
 * Batch point-read assets by cuid, scoped to one org. Lets a detail composite
 * (e.g. getKit) read only its member assets by id instead of collecting the whole
 * org registry (getAssetsByOrg) and filtering in JS. Cross-org ids are dropped,
 * never returned. Order is NOT guaranteed (callers key by id).
 */
export const listByIds = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgRead(ctx, orgId);
    // Dedupe + cap: this is user-callable, so an unbounded id array would fan out
    // arbitrarily many point-reads. 1000 is comfortable headroom over any real
    // detail composite's member count.
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("assets.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
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
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const _id = await ctx.db.insert("assets", args);
    await bumpCountersForTable(ctx, "assets", null, args);
    return _id;
  },
});

/**
 * Insert many assets in ONE atomic mutation with an in-transaction duplicate-tag
 * guard — collapses createAssets' per-asset loop (dup-guard read + create +
 * read-back = 3 round-trips per asset). The guard uses the by_organizationId_
 * assetTag index and also catches duplicates WITHIN the batch (a prior insert in
 * the same transaction is visible). On a dup it throws a structured ConvexError
 * the server action maps to its DUPLICATE_ASSET_TAG UserFacingError.
 */
export const createMany = mutation({
  args: {
    assets: v.array(
      v.object({
        id: v.string(),
        organizationId: v.string(),
        modelId: v.string(),
        assetTag: v.string(),
        serialNumber: v.optional(v.string()),
        customName: v.optional(v.string()),
        status: v.optional(enums.AssetStatus),
        condition: v.optional(enums.AssetCondition),
        purchaseDate: v.optional(v.number()),
        purchasePrice: v.optional(v.number()),
        purchaseSupplier: v.optional(v.string()),
        supplierId: v.optional(v.string()),
        purchaseOrderNumber: v.optional(v.string()),
        supplierOrderId: v.optional(v.string()),
        warrantyExpiry: v.optional(v.number()),
        notes: v.optional(v.string()),
        locationId: v.optional(v.string()),
        customFieldValues: v.optional(v.any()),
        lastTestAndTagDate: v.optional(v.number()),
        nextTestAndTagDate: v.optional(v.number()),
        barcode: v.optional(v.string()),
        qrCode: v.optional(v.string()),
        images: v.optional(v.array(v.string())),
        tags: v.optional(v.array(v.string())),
        isActive: v.optional(v.boolean()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
        kitId: v.optional(v.string()),
        parentAssetId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { assets }) => {
    await requireService(ctx);
    const ids: string[] = [];
    for (const a of assets) {
      const dup = await ctx.db
        .query("assets")
        .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", a.organizationId).eq("assetTag", a.assetTag))
        .first();
      if (dup) throw new ConvexError({ code: "DUPLICATE_ASSET_TAG", tag: a.assetTag });
      await ctx.db.insert("assets", a);
      await bumpCountersForTable(ctx, "assets", null, a);
      ids.push(a.id);
    }
    return { ids };
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("assets", args);
    await bumpCountersForTable(ctx, "assets", null, args);
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
      serialNumber: v.optional(v.string()),
      customName: v.optional(v.string()),
      status: v.optional(enums.AssetStatus),
      condition: v.optional(enums.AssetCondition),
      purchaseDate: v.optional(v.number()),
      purchasePrice: v.optional(v.number()),
      purchaseSupplier: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      purchaseOrderNumber: v.optional(v.string()),
      supplierOrderId: v.optional(v.string()),
      warrantyExpiry: v.optional(v.number()),
      notes: v.optional(v.string()),
      locationId: v.optional(v.string()),
      customFieldValues: v.optional(v.any()),
      lastTestAndTagDate: v.optional(v.number()),
      nextTestAndTagDate: v.optional(v.number()),
      barcode: v.optional(v.string()),
      qrCode: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      kitId: v.optional(v.string()),
      parentAssetId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    await bumpCountersForTable(ctx, "assets", doc, { ...doc, ...safePatch });
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    await ctx.db.delete(doc._id);
    await bumpCountersForTable(ctx, "assets", doc, null);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core mega-flip) — re-add on regen ──────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const ASSET_NEVER_CLEAR = new Set(["id", "organizationId", "modelId", "assetTag"]);

// Patchable asset fields (= update.patch minus organizationId). Reused by
// patchAsset + bulkUpdate so the clear-to-null pattern stays consistent.
const assetSet = v.object({
  modelId: v.optional(v.string()),
  assetTag: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  customName: v.optional(v.string()),
  status: v.optional(enums.AssetStatus),
  condition: v.optional(enums.AssetCondition),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
  purchaseSupplier: v.optional(v.string()),
  supplierId: v.optional(v.string()),
  purchaseOrderNumber: v.optional(v.string()),
  supplierOrderId: v.optional(v.string()),
  warrantyExpiry: v.optional(v.number()),
  notes: v.optional(v.string()),
  locationId: v.optional(v.string()),
  customFieldValues: v.optional(v.any()),
  lastTestAndTagDate: v.optional(v.number()),
  nextTestAndTagDate: v.optional(v.number()),
  barcode: v.optional(v.string()),
  qrCode: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  isActive: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  kitId: v.optional(v.string()),
  parentAssetId: v.optional(v.string()),
});

/**
 * Clear-to-null patch (crewMembers.patchMember pattern): `set` applies values,
 * every name in `clear[]` is removed from the doc. Needed because the generated
 * `update` can't unset an optional field (e.g. clear kitId on kit removal, clear
 * locationId, unlink parentAssetId/supplierId).
 */
export const patchAsset = mutation({
  args: { id: v.string(), set: assetSet, clear: v.array(v.string()) },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set);
      await bumpCountersForTable(ctx, "assets", doc, { ...doc, ...set });
      return doc._id;
    }
    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = { ...rest, ...set };
    for (const k of clear) {
      if (ASSET_NEVER_CLEAR.has(k)) continue;
      delete merged[k];
    }
    await ctx.db.replace(doc._id, merged as typeof rest);
    await bumpCountersForTable(ctx, "assets", doc, merged);
    return doc._id;
  },
});

/**
 * Apply the same `set` (+ optional `clear`) to many assets in one transaction —
 * the Convex equivalent of `asset.updateMany` (bulk edit, warehouse force-return
 * → AVAILABLE + location, maintenance hold/release). Cross-org / missing ids are
 * skipped. Returns the count updated.
 */
export const bulkUpdate = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.string()),
    set: assetSet,
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { organizationId, ids, set, clear }) => {
    await requireService(ctx);
    const cl = clear ?? [];
    let n = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue;
      if (cl.length === 0) {
        await ctx.db.patch(doc._id, set);
        await bumpCountersForTable(ctx, "assets", doc, { ...doc, ...set });
      } else {
        const { _id, _creationTime, ...rest } = doc;
        const merged: Record<string, unknown> = { ...rest, ...set };
        for (const k of cl) {
          if (ASSET_NEVER_CLEAR.has(k)) continue;
          delete merged[k];
        }
        await ctx.db.replace(doc._id, merged as typeof rest);
        await bumpCountersForTable(ctx, "assets", doc, merged);
      }
      n++;
    }
    return n;
  },
});

/**
 * Bulk APPEND tags to N assets in a SINGLE call (Appendix A invariant — powers
 * the assets bulk-bar "Add tags"). Unlike bulkUpdate (which replaces a field),
 * this unions the supplied tags into each asset's existing `tags` array. Per-row
 * org re-check (by_cuid is GLOBAL). Idempotent: a tag already present is a no-op.
 * Tags don't feed any counter, so no counter bump. Returns the count of
 * org-matched assets processed.
 */
export const bulkAddTags = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.string()),
    tags: v.array(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, { organizationId, ids, tags }) => {
    await requireService(ctx);
    const add = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    if (add.length === 0) return 0;
    let n = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue;
      n++;
      const existing = doc.tags ?? [];
      const merged = [...new Set([...existing, ...add])];
      if (merged.length === existing.length) continue; // all already present
      await ctx.db.patch(doc._id, { tags: merged, updatedAt: Date.now() });
    }
    return n;
  },
});

// ── CUSTOM (Phase C H) — child-asset lookup ──
export const listByParentAssetId = query({
  args: { parentAssetId: v.string(), orgId: v.string() },
  handler: async (ctx, { parentAssetId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return (await ctx.db.query("assets").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", parentAssetId)).collect())
      .filter((r) => r.organizationId === orgId);
  },
});
