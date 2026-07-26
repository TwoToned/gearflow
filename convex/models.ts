import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Model (Convex table "models"). GENERATED — Phase 2/5.
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
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("models")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: deliberate reactive full-org read (perf-convex-efficiency-2026-06.md); accepted R-9.8 tradeoff for live updates — revisit with paginated reactivity if per-org rows grow large — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Per-model ACTIVE asset + bulk-asset counts + primary photo (modelId → { assets,
 * bulkAssets, media }) for the models table — browser-native replacement for the
 * getModelCounts server action. Parity: counts assets/bulkAssets with
 * isActive !== false; media = the model's PHOTO+isPrimary modelMedia row's file
 * url/thumbnailUrl (buildPrimaryPhotoMap), org-scoped file resolve. Fetched
 * ONE-SHOT by the table (no liveness need), so this reads 3 org tables + point
 * file reads without being a reactive org-wide subscription (Appendix B).
 */
export const counts = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    type Entry = { assets: number; bulkAssets: number; media: { url: string | null; thumbnailUrl: string | null } | null };
    const out: Record<string, Entry> = {};
    const ensure = (id: string) => (out[id] ??= { assets: 0, bulkAssets: 0, media: null });

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — per-org tallies need the full set — see docs/exceptions.md R-8.3.3
      .collect();
    for (const a of assets) if (a.isActive !== false) ensure(a.modelId).assets++;

    const bulkAssets = await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — per-org tallies need the full set — see docs/exceptions.md R-8.3.3
      .collect();
    for (const b of bulkAssets) if (b.isActive !== false) ensure(b.modelId).bulkAssets++;

    // Primary photo per model (PHOTO + isPrimary), file resolved org-scoped.
    const media = await ctx.db
      .query("modelMedia")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — per-org tallies need the full set — see docs/exceptions.md R-8.3.3
      .collect();
    for (const m of media) {
      if (m.type !== "PHOTO" || !m.isPrimary) continue;
      const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).unique();
      const resolved = file && file.organizationId === orgId ? file : null;
      ensure(m.modelId).media = { url: resolved?.url ?? null, thumbnailUrl: resolved?.thumbnailUrl ?? null };
    }

    return out;
  },
});

/**
 * Model DETAIL composite — browser-native replacement for the `getModel` server
 * action. Returns the model scalars + category + active assets/bulkAssets
 * (assetTag ASC, location attached) + media gallery (file-resolved) + bulk
 * accessories (with bulkAsset + model name). Org derived + authorized from the
 * fetched model via requireOrgReadDoc; null-model short-circuits to null (parity
 * with the old `serialize(null)` not-found path). Every relation is fetched by a
 * SCOPED index (by_modelId/by_organizationId) and org-re-checked (the by_modelId /
 * by_cuid indexes are GLOBAL). One-shot composite (Appendix B — not reactive).
 */
export const detail = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!model) return null;
    await requireOrgReadDoc(ctx, model);
    const orgId = model.organizationId;

    // Org locations → map (attachLocation equivalent).
    const locations = await ctx.db
      .query("locations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org catalog/config map (detail enrichment) — see docs/exceptions.md R-8.3.3
      .collect();
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const attachLoc = <T extends { locationId?: string | null }>(r: T) => ({
      ...r,
      location: r.locationId ? locationMap.get(r.locationId) ?? null : null,
    });

    // Active assets + bulk assets for this model (assetTag ASC), org-re-checked.
    const byAssetTag = (a: { assetTag: string }, b: { assetTag: string }) => a.assetTag.localeCompare(b.assetTag);
    const assetsRaw = await ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", id)).collect();
    const assets = assetsRaw
      .filter((a) => a.organizationId === orgId && a.isActive !== false)
      .sort(byAssetTag)
      .map((a) => attachLoc({ ...a, locationId: a.locationId ?? null, status: a.status ?? "AVAILABLE" }));
    const bulkRaw = await ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", id)).collect();
    const bulkAssets = bulkRaw
      .filter((b) => b.organizationId === orgId && b.isActive !== false)
      .sort(byAssetTag)
      .map((b) => attachLoc({
        ...b,
        locationId: b.locationId ?? null,
        status: b.status ?? "ACTIVE",
        availableQuantity: b.availableQuantity ?? 0,
        totalQuantity: b.totalQuantity ?? 0,
        isActive: b.isActive ?? true,
      }));

    // Category from the org category map.
    const category = model.categoryId
      ? await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", model.categoryId!)).unique()
      : null;
    const resolvedCategory = category && category.organizationId === orgId ? category : null;

    // Media gallery (modelMedia + resolved file), sorted by sortOrder, drop unresolved.
    const mediaRows = (await ctx.db.query("modelMedia").withIndex("by_modelId", (q) => q.eq("modelId", id)).collect())
      .filter((m) => m.organizationId === orgId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const media: Array<{
      id: string; organizationId: string; fileId: string; displayName: string | null; sortOrder: number;
      modelId: string; type: string; isPrimary: boolean;
      file: { id: string; fileName: string; fileSize: number; mimeType: string; url: string; thumbnailUrl: string | null };
    }> = [];
    for (const m of mediaRows) {
      const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).unique();
      if (!file || file.organizationId !== orgId) continue;
      media.push({
        id: m.id,
        organizationId: m.organizationId,
        fileId: m.fileId,
        displayName: m.displayName ?? null,
        sortOrder: m.sortOrder ?? 0,
        modelId: m.modelId,
        type: m.type ?? "PHOTO",
        isPrimary: m.isPrimary ?? false,
        file: {
          id: file.id,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          url: file.url,
          thumbnailUrl: file.thumbnailUrl ?? null,
        },
      });
    }

    // Bulk accessories (with bulkAsset assetTag + model name).
    const modelsForOrg = await ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: bounded per-org catalog/config map (detail enrichment) — see docs/exceptions.md R-8.3.3
    const modelNameMap = new Map(modelsForOrg.map((m) => [m.id, m]));
    const accRows = (await ctx.db.query("modelBulkAccessories").withIndex("by_modelId", (q) => q.eq("modelId", id)).collect())
      .filter((r) => r.organizationId === orgId);
    const bulkAccessories: Array<{
      id: string; organizationId: string; modelId: string; bulkAssetId: string; quantity: number;
      inclusion: "DEFAULT" | "OPTIONAL";
      sortOrder: number | null; notes: string | null; addedAt: number | null; addedById: string;
      bulkAsset: { id: string; assetTag: string; modelId: string | null; model: { id: string; name: string } | null };
    }> = [];
    for (const ba of accRows) {
      const bulkAsset = ba.bulkAssetId
        ? await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", ba.bulkAssetId)).unique()
        : null;
      const resolvedBulk = bulkAsset && bulkAsset.organizationId === orgId ? bulkAsset : null;
      const bulkModel = resolvedBulk?.modelId ? modelNameMap.get(resolvedBulk.modelId) ?? null : null;
      bulkAccessories.push({
        id: ba.id,
        organizationId: ba.organizationId,
        modelId: ba.modelId,
        bulkAssetId: ba.bulkAssetId,
        quantity: ba.quantity,
        inclusion: ba.inclusion ?? "DEFAULT",
        sortOrder: ba.sortOrder ?? null,
        notes: ba.notes ?? null,
        addedAt: ba.addedAt ?? null,
        addedById: ba.addedById,
        bulkAsset: {
          id: ba.bulkAssetId,
          assetTag: resolvedBulk?.assetTag ?? "",
          modelId: resolvedBulk?.modelId ?? null,
          model: bulkModel ? { id: bulkModel.id, name: bulkModel.name } : null,
        },
      });
    }

    return {
      ...model,
      images: model.images ?? [],
      manuals: model.manuals ?? [],
      tags: model.tags ?? [],
      assetType: model.assetType ?? "SERIALIZED",
      requiresTestAndTag: model.requiresTestAndTag ?? false,
      isActive: model.isActive ?? true,
      category: resolvedCategory,
      assets,
      bulkAssets,
      media,
      bulkAccessories,
    };
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    manufacturer: v.optional(v.string()),
    modelNumber: v.optional(v.string()),
    sku: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    manuals: v.optional(v.array(v.string())),
    specifications: v.optional(v.any()),
    customFields: v.optional(v.any()),
    defaultRentalPrice: v.optional(v.number()),
    dailyRate: v.optional(v.number()),
    weeklyRate: v.optional(v.number()),
    monthlyRate: v.optional(v.number()),
    defaultPurchasePrice: v.optional(v.number()),
    replacementCost: v.optional(v.number()),
    weight: v.optional(v.number()),
    powerDraw: v.optional(v.number()),
    requiresTestAndTag: v.optional(v.boolean()),
    testAndTagIntervalDays: v.optional(v.number()),
    defaultEquipmentClass: v.optional(enums.EquipmentClass),
    defaultApplianceType: v.optional(enums.ApplianceType),
    defaultTestProfileId: v.optional(v.string()),
    maintenanceIntervalDays: v.optional(v.number()),
    assetType: v.optional(enums.AssetType),
    barcodeLabelTemplate: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("models", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    manufacturer: v.optional(v.string()),
    modelNumber: v.optional(v.string()),
    sku: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    manuals: v.optional(v.array(v.string())),
    specifications: v.optional(v.any()),
    customFields: v.optional(v.any()),
    defaultRentalPrice: v.optional(v.number()),
    dailyRate: v.optional(v.number()),
    weeklyRate: v.optional(v.number()),
    monthlyRate: v.optional(v.number()),
    defaultPurchasePrice: v.optional(v.number()),
    replacementCost: v.optional(v.number()),
    weight: v.optional(v.number()),
    powerDraw: v.optional(v.number()),
    requiresTestAndTag: v.optional(v.boolean()),
    testAndTagIntervalDays: v.optional(v.number()),
    defaultEquipmentClass: v.optional(enums.EquipmentClass),
    defaultApplianceType: v.optional(enums.ApplianceType),
    defaultTestProfileId: v.optional(v.string()),
    maintenanceIntervalDays: v.optional(v.number()),
    assetType: v.optional(enums.AssetType),
    barcodeLabelTemplate: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("models", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      manufacturer: v.optional(v.string()),
      modelNumber: v.optional(v.string()),
      sku: v.optional(v.string()),
      categoryId: v.optional(v.string()),
      description: v.optional(v.string()),
      image: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      manuals: v.optional(v.array(v.string())),
      specifications: v.optional(v.any()),
      customFields: v.optional(v.any()),
      defaultRentalPrice: v.optional(v.number()),
      dailyRate: v.optional(v.number()),
      weeklyRate: v.optional(v.number()),
      monthlyRate: v.optional(v.number()),
      defaultPurchasePrice: v.optional(v.number()),
      replacementCost: v.optional(v.number()),
      weight: v.optional(v.number()),
      powerDraw: v.optional(v.number()),
      requiresTestAndTag: v.optional(v.boolean()),
      testAndTagIntervalDays: v.optional(v.number()),
      defaultEquipmentClass: v.optional(enums.EquipmentClass),
      defaultApplianceType: v.optional(enums.ApplianceType),
      defaultTestProfileId: v.optional(v.string()),
      maintenanceIntervalDays: v.optional(v.number()),
      assetType: v.optional(enums.AssetType),
      barcodeLabelTemplate: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("models not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

/**
 * Bulk rate update (bulk single-call invariant, Phase 3): apply N pre-computed rate
 * patches in ONE array mutation instead of the server firing one `update` round-trip
 * per model. Each entry's `newRate` is computed by the caller (which reads current
 * rates); this only persists them. Per-item `organizationId` re-check — `by_cuid` is a
 * GLOBAL index, so a model from another org is skipped, never patched. Setting
 * `dailyRate` auto-syncs `defaultRentalPrice` (mirrors the singular server path).
 * Returns how many were actually applied.
 */
export const bulkUpdateRates = mutation({
  args: {
    organizationId: v.string(),
    updates: v.array(
      v.object({
        id: v.string(),
        rateType: v.union(v.literal("dailyRate"), v.literal("weeklyRate"), v.literal("monthlyRate")),
        newRate: v.number(),
      }),
    ),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, updates, now }) => {
    await requireService(ctx);
    let count = 0;
    for (const u of updates) {
      const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", u.id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue; // per-item org re-check
      const patch: Record<string, number> = { [u.rateType]: u.newRate, updatedAt: now };
      if (u.rateType === "dailyRate") patch.defaultRentalPrice = u.newRate;
      await ctx.db.patch(doc._id, patch);
      count++;
    }
    return { count };
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("models not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
