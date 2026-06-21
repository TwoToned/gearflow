"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { getPrimaryPhotoMap, getModelMediaFromConvex, withResolvedFile } from "@/lib/media-read";
import {
  getModelById,
  getModelMap,
  getModelsByOrg,
  mapConvexModelToRow,
  filterModels,
  sortModels,
  paginateModels,
} from "@/lib/models-read";
import { getCategoryMap, type ConvexCategory } from "@/lib/categories-read";
import {
  getAssetsByOrg,
  getBulkAssetsByOrg,
  getActiveAssetsByModel,
  getActiveBulkAssetsByModel,
} from "@/lib/assets-read";
import { attachLocation } from "@/lib/locations-read";
import { api } from "../../convex/_generated/api";
import { serialize } from "@/lib/serialize";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { z } from "zod";
import { modelSchema, type ModelFormValues } from "@/lib/validations/model";
import type { Model as PrismaModel } from "@/generated/prisma/client";

type ParsedModel = z.output<typeof modelSchema>;
import { backfillTestTagAssets } from "@/server/test-tag-assets";
import { getOrgTestTagSettings } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import type { FilterValue } from "@/lib/table-utils";

// Models are CONVEX-ONLY (Phase B write inversion): createModel / updateModel /
// archiveModel / bulkUpdateRates write the Convex `models` doc as the sole source
// of truth — no Prisma `model` row, no mirror. The inbound Prisma FKs into the
// frozen `model` table (asset.modelId / bulk_asset.modelId [were required+Restrict];
// project_line_item.modelId / supplier_order_item.modelId / sub_hire_item.modelId
// [were SetNull]; model_media.modelId / model_check_item.modelId /
// model_bulk_accessory.modelId / group_template_item.modelId / supplier_model_rate
// .modelId [were Cascade]) were dropped (migration
// 20260617131200_drop_model_fk_constraints), so each is now a plain string holding
// the Convex cuid.
//
// Invariants re-implemented in app code (Convex has no constraints/cascades):
//  - org-guard: reads the target via getModelById and verifies organizationId
//    before any update / archive (matches the old where:{id,organizationId}).
//  - No hard delete: models are only SOFT-archived (isActive=false), so the dropped
//    Cascade FKs never fired via a model delete — no cascade re-impl is needed.
//    archiveModel keeps its existing asset/bulk-asset deletion side-effects; those
//    rows are Convex-only now (core mega-flip), so it queries + removes them directly
//    in Convex (no Prisma deleteMany, no mirror).
//  - Decimal rate columns + Json (specifications/customFields) round-trip through
//    Convex as numbers / v.any(); mapConvexModelToRow maps the doc back to the
//    Prisma-row shape the callers (model-form `result.id`, activity log) expect.
//
// Reads (list, detail-composite assets/bulk/category, counts) already source from
// Convex via models-read.ts. See FEATUREDOCS/54 + the decommission runbook.

/** Build the Convex `models` create/update payload from parsed form values.
 *  Decimal columns are passed as plain numbers; `undefined` clears the field
 *  (matching the old Prisma `|| null` / conditional clears). */
function toConvexModelArgs(parsed: ParsedModel) {
  return {
    name: parsed.name,
    manufacturer: parsed.manufacturer ?? undefined,
    modelNumber: parsed.modelNumber ?? undefined,
    sku: parsed.sku || undefined,
    categoryId: parsed.categoryId || undefined,
    description: parsed.description ?? undefined,
    image: parsed.image ?? undefined,
    images: parsed.images ?? [],
    manuals: parsed.manuals ?? [],
    specifications: parsed.specifications ?? undefined,
    customFields: parsed.customFields ?? undefined,
    defaultRentalPrice: parsed.dailyRate ?? parsed.defaultRentalPrice ?? undefined,
    dailyRate: parsed.dailyRate ?? undefined,
    weeklyRate: parsed.weeklyRate ?? undefined,
    monthlyRate: parsed.monthlyRate ?? undefined,
    defaultPurchasePrice: parsed.defaultPurchasePrice ?? undefined,
    replacementCost: parsed.replacementCost ?? undefined,
    weight: parsed.weight ?? undefined,
    powerDraw: parsed.powerDraw ?? undefined,
    requiresTestAndTag: parsed.requiresTestAndTag,
    testAndTagIntervalDays: parsed.requiresTestAndTag
      ? parsed.testAndTagIntervalDays ?? undefined
      : undefined,
    defaultTestProfileId: parsed.requiresTestAndTag
      ? parsed.defaultTestProfileId || undefined
      : undefined,
    defaultEquipmentClass: parsed.requiresTestAndTag
      ? (parsed.defaultEquipmentClass || "CLASS_I")
      : undefined,
    defaultApplianceType: parsed.requiresTestAndTag
      ? (parsed.defaultApplianceType || "APPLIANCE")
      : undefined,
    maintenanceIntervalDays: parsed.maintenanceIntervalDays ?? undefined,
    assetType: parsed.assetType,
    barcodeLabelTemplate: parsed.barcodeLabelTemplate ?? undefined,
    isActive: parsed.isActive,
    tags: parsed.tags ?? [],
  };
}

// The Model→Category FK was dropped in Phase B (categories are Convex-only), so
// the `category` relation can no longer be expressed via `Prisma.ModelGetPayload`.
// The attached `category` now comes off the Convex category map (a ConvexCategory
// doc or null). The base Model row + the JS-computed `_count` are spelled out.
export type ModelWithRelations = PrismaModel & {
  category: ConvexCategory | null;
  _count: { assets: number; bulkAssets: number };
};

/**
 * Paginated model list — read from the reactive Convex `models` mirror.
 *
 * Convex `models.list({orgId})` returns ALL of the org's models, so the Prisma
 * `where` (isActive / categoryId / assetType / search) and `orderBy` are
 * re-applied in JS via the pure helpers in `src/lib/models-read.ts`. The nested
 * `category` (dual-written) is attached from the Convex category map; per-model
 * asset/bulk `_count` come off the Convex asset/bulkAsset mirror and the primary
 * photo off the Convex modelMedia mirror (same sources as getModelCounts). No
 * Prisma fallback on a Convex map miss. See FEATUREDOCS/54.
 */
export async function getModels(params?: {
  search?: string;
  categoryId?: string;
  assetType?: "SERIALIZED" | "BULK";
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, FilterValue>;
}) {
  const { organizationId } = await getOrgContext();
  const { search, categoryId, assetType, isActive = true, page = 1, pageSize = 25, sortBy = "name", sortOrder = "asc", filters } = params || {};

  // The DataTable `filters` for this surface only carries the categoryId /
  // assetType enum columns (see the column defs); fold the first selected value
  // of each into the explicit filter (mirrors buildFilterWhere's enum `in`,
  // which with a single value behaves like equality for these single-value cols).
  const filterCategoryIds = Array.isArray(filters?.categoryId) ? (filters!.categoryId as string[]) : [];
  const filterAssetTypes = Array.isArray(filters?.assetType) ? (filters!.assetType as string[]) : [];

  const [convexModels, categoryMap, allAssets, allBulkAssets, photoMap] = await Promise.all([
    getModelsByOrg(organizationId),
    getCategoryMap(organizationId),
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
    getPrimaryPhotoMap("model", organizationId),
  ]);

  const rows = convexModels.map(mapConvexModelToRow);
  const categoryNameOf = (m: { categoryId?: string | null }) =>
    m.categoryId ? categoryMap.get(m.categoryId)?.name ?? null : null;

  let filtered = filterModels(rows, { isActive, categoryId, assetType, search });
  if (filterCategoryIds.length > 0) filtered = filtered.filter((m) => filterCategoryIds.includes(m.categoryId ?? ""));
  if (filterAssetTypes.length > 0) filtered = filtered.filter((m) => filterAssetTypes.includes(m.assetType));

  const total = filtered.length;
  const sorted = sortModels(filtered, sortBy, sortOrder, categoryNameOf);
  const pageRows = paginateModels(sorted, page, pageSize);

  // Per-model asset/bulk counts (active only) off the Convex mirror.
  const assetCount = new Map<string, number>();
  const bulkCount = new Map<string, number>();
  for (const a of allAssets) if (a.isActive !== false) assetCount.set(a.modelId, (assetCount.get(a.modelId) ?? 0) + 1);
  for (const b of allBulkAssets) if (b.isActive !== false) bulkCount.set(b.modelId, (bulkCount.get(b.modelId) ?? 0) + 1);

  const models = pageRows.map((m) => {
    const photo = photoMap[m.id];
    return {
      ...m,
      category: m.categoryId ? categoryMap.get(m.categoryId) ?? null : null,
      _count: { assets: assetCount.get(m.id) ?? 0, bulkAssets: bulkCount.get(m.id) ?? 0 },
      // Primary photo as a single-element media array (mirrors the Prisma
      // `media: { where: { isPrimary }, take: 1 }` include shape used here).
      media: photo ? [{ url: photo.url, thumbnailUrl: photo.thumbnailUrl }] : [],
    };
  });

  return serialize({ models, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

/**
 * Per-model asset/bulk-asset counts + primary photo (modelId -> meta).
 * Cross-domain: assets + bulk assets still live in Prisma (counts come off the
 * fresh mirror); the primary photo comes off the Convex `modelMedia` +
 * `fileUploads` mirror via getPrimaryPhotoMap (Phase 6 decommission — model_media
 * is now dual-written). Used by the reactive model table, which subscribes to the
 * model list via Convex and merges these (non-reactive) values in.
 */
export async function getModelCounts(): Promise<
  Record<string, { assets: number; bulkAssets: number; media: { url: string | null; thumbnailUrl: string | null } | null }>
> {
  const { organizationId } = await getOrgContext();
  const [allAssets, allBulkAssets, photoMap] = await Promise.all([
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
    getPrimaryPhotoMap("model", organizationId),
  ]);
  const out: Record<string, { assets: number; bulkAssets: number; media: { url: string | null; thumbnailUrl: string | null } | null }> = {};
  const ensure = (id: string) => (out[id] ??= { assets: 0, bulkAssets: 0, media: null });
  for (const a of allAssets) if (a.isActive !== false) ensure(a.modelId).assets++;
  for (const b of allBulkAssets) if (b.isActive !== false) ensure(b.modelId).bulkAssets++;
  for (const [modelId, meta] of Object.entries(photoMap)) ensure(modelId).media = meta;
  return serialize(out);
}

// Detail-page composite. Models are Convex-only (Phase B), so the deep Prisma
// `include` of the dropped back-relations (assets / bulkAssets) is rebuilt from
// the Convex asset/bulk mirror (active only, assetTag ASC, location attached).
// `media` and `bulkAccessories` stay Prisma reads — they're queried by the plain
// `modelId` column (the dropped FK only removed the constraint, not the column)
// and their own relations (file / bulkAsset) are intact; the media gallery is the
// documented detail-page terminus. The model scalars are read from Convex via
// getModelById; `category` (a Convex doc) is attached from the model map.
export async function getModel(id: string) {
  const { organizationId } = await getOrgContext();
  const doc = await getModelById(id);
  if (!doc || doc.organizationId !== organizationId) return serialize(null);
  const model = mapConvexModelToRow(doc);

  const convex = await getConvexClient();
  const [categoryMap, convexAssets, convexBulk, mediaRows, bulkAccessoriesRaw, modelMap] =
    await Promise.all([
      getCategoryMap(organizationId),
      getActiveAssetsByModel(id, organizationId),
      getActiveBulkAssetsByModel(id, organizationId),
      // modelMedia gallery from the Convex mirror (was a Prisma modelMedia + file
      // join). Dual-written → identical data. See media-read.ts.
      getModelMediaFromConvex(id).then((rows) =>
        rows.filter((m) => m.organizationId === organizationId),
      ),
      convex.query(api.modelBulkAccessories.listByModelId, { modelId: id, organizationId }),
      getModelMap(organizationId),
    ]);

  const byAssetTag = (a: { assetTag: string }, b: { assetTag: string }) =>
    a.assetTag.localeCompare(b.assetTag);
  // Location FK was dropped (Phase B); attach `location` from the Convex mirror.
  // attachLocation needs `locationId: string | null` (Convex docs leave it
  // `string | undefined`); also coerce the Prisma-defaulted columns the Convex
  // doc leaves absent (status / availableQuantity / totalQuantity / isActive) so
  // the rows match the non-null Prisma-row shape the detail page reads.
  const assetRows = [...convexAssets].sort(byAssetTag).map((a) => ({
    ...a,
    locationId: a.locationId ?? null,
    status: a.status ?? "AVAILABLE",
  }));
  const bulkRows = [...convexBulk].sort(byAssetTag).map((b) => ({
    ...b,
    locationId: b.locationId ?? null,
    status: b.status ?? "ACTIVE",
    availableQuantity: b.availableQuantity ?? 0,
    totalQuantity: b.totalQuantity ?? 0,
    isActive: b.isActive ?? true,
  }));
  const [assetsWithLoc, bulkWithLoc] = await Promise.all([
    attachLocation(organizationId, assetRows),
    attachLocation(organizationId, bulkRows),
  ]);

  const enriched = {
    ...model,
    category: model.categoryId ? categoryMap.get(model.categoryId) ?? null : null,
    assets: assetsWithLoc,
    bulkAssets: bulkWithLoc,
    media: withResolvedFile(mediaRows),
    bulkAccessories: bulkAccessoriesRaw.map((ba) => ({
      id: ba.id,
      organizationId: ba.organizationId,
      modelId: ba.modelId,
      bulkAssetId: ba.bulkAssetId,
      quantity: ba.quantity,
      sortOrder: ba.sortOrder ?? null,
      notes: ba.notes ?? null,
      addedAt: ba.addedAt ? new Date(ba.addedAt) : null,
      addedById: ba.addedById,
      bulkAsset: {
        id: ba.bulkAssetId,
        assetTag: ba.bulkAssetAssetTag ?? "",
        modelId: ba.bulkAssetModelId ?? null,
        model: ba.bulkAssetModelId ? modelMap.get(ba.bulkAssetModelId) ?? null : null,
      },
    })),
  };
  return serialize(enriched);
}

export async function createModel(data: ModelFormValues) {
  const { organizationId, userId, userName } = await requirePermission("model", "create");
  const parsed = modelSchema.parse(data);

  // Explicit cuid so external references (asset/bulk/line-item .modelId) hold the
  // same id Convex stores. Models are Convex-only — write the doc directly.
  const id = createId();
  const now = Date.now();
  const args = toConvexModelArgs(parsed);
  await (await getConvexClient()).mutation(api.models.create, {
    id,
    organizationId,
    ...args,
    createdAt: now,
    updatedAt: now,
  });

  // Map the written doc back to the Prisma-row shape callers expect (model-form
  // reads `result.id`; activity log reads name/manufacturer).
  const model = mapConvexModelToRow({
    _id: "" as never,
    _creationTime: now,
    id,
    organizationId,
    ...args,
    createdAt: now,
    updatedAt: now,
  } as unknown as Parameters<typeof mapConvexModelToRow>[0]);

  if (parsed.requiresTestAndTag) {
    await backfillTestTagAssets();
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "model",
    entityId: model.id,
    entityName: model.name,
    summary: `Created model ${model.name}`,
    details: { created: { name: model.name, manufacturer: model.manufacturer ?? null } },
  });

  return serialize(model);
}

export async function updateModel(id: string, data: ModelFormValues) {
  const { organizationId, userId, userName } = await requirePermission("model", "update");
  const parsed = modelSchema.parse(data);

  const existing = await getModelById(id);
  if (!existing || existing.organizationId !== organizationId) throw new Error("Model not found");

  // Convex `db.patch` treats `undefined` as field removal, matching the old Prisma
  // `|| null` / conditional T&T clears.
  const args = toConvexModelArgs(parsed);
  await (await getConvexClient()).mutation(api.models.update, {
    id,
    patch: { ...args, updatedAt: Date.now() },
  });

  const model = mapConvexModelToRow({
    ...existing,
    ...args,
    updatedAt: Date.now(),
  } as unknown as Parameters<typeof mapConvexModelToRow>[0]);

  if (parsed.requiresTestAndTag) {
    await backfillTestTagAssets();

    // Propagate updated T&T defaults to all active linked TestTagAssets for this model's assets
    const orgTT = await getOrgTestTagSettings();
    const equipmentClass = parsed.defaultEquipmentClass || "CLASS_I";
    const applianceType = parsed.defaultApplianceType || "APPLIANCE";
    const intervalMonths = parsed.testAndTagIntervalDays
      ? Math.max(1, Math.round(parsed.testAndTagIntervalDays / 30))
      : (orgTT.defaultIntervalMonths || 3);

    const assetIds = (await getActiveAssetsByModel(id, organizationId)).map((a) => a.id);

    if (assetIds.length > 0) {
      // Propagate T&T defaults to active Convex testTagAsset rows linked to these assets.
      const convexForTT = await getConvexClient();
      const ttNow = Date.now();
      for (const assetId of assetIds) {
        const ttRows = await convexForTT.query(api.testTagAssets.listByAssetId, { assetId });
        for (const tt of ttRows) {
          if (tt.isActive === false) continue;
          await convexForTT.mutation(api.testTagAssets.update, {
            id: tt.id,
            patch: { equipmentClass, applianceType, testIntervalMonths: intervalMonths, updatedAt: ttNow },
          });
        }
      }
    }
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: model.id,
    entityName: model.name,
    summary: `Updated model ${model.name}`,
  });

  return serialize(model);
}

export async function archiveModel(id: string) {
  const { organizationId, userId, userName } = await requirePermission("model", "delete");

  // Delete all assets and bulk assets under this model — assets/bulkAssets are
  // Convex-only (core mega-flip). Query the model's rows from Convex, then remove
  // each directly.
  const convexForAssets = await getConvexClient();
  const [assetsToRemove, bulkToRemove] = await Promise.all([
    convexForAssets.query(api.assets.listByModel, { modelId: id, orgId: organizationId }),
    convexForAssets.query(api.bulkAssets.listByModel, { modelId: id, orgId: organizationId }),
  ]);
  for (const a of assetsToRemove) {
    if (a.organizationId === organizationId) await convexForAssets.mutation(api.assets.remove, { id: a.id });
  }
  for (const b of bulkToRemove) {
    if (b.organizationId === organizationId) await convexForAssets.mutation(api.bulkAssets.remove, { id: b.id });
  }

  // Soft archive — models are Convex-only. Org-guard via the prior doc.
  const existing = await getModelById(id);
  if (!existing || existing.organizationId !== organizationId) throw new Error("Model not found");
  await (await getConvexClient()).mutation(api.models.update, {
    id,
    patch: { isActive: false, updatedAt: Date.now() },
  });
  const archived = mapConvexModelToRow({
    ...existing,
    isActive: false,
    updatedAt: Date.now(),
  } as unknown as Parameters<typeof mapConvexModelToRow>[0]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "model",
    entityId: id,
    entityName: archived.name,
    summary: `Archived model ${archived.name}`,
  });

  return serialize(archived);
}

export async function bulkUpdateRates(
  modelIds: string[],
  rateType: "dailyRate" | "weeklyRate" | "monthlyRate",
  operation: "set" | "multiply" | "increase_percent",
  value: number
) {
  const { organizationId, userId, userName } = await requirePermission("model", "update");

  if (modelIds.length === 0) throw new Error("No models selected");
  if (operation === "set" && value < 0) throw new Error("Rate cannot be negative");
  if (operation === "multiply" && value <= 0) throw new Error("Multiplier must be positive");

  // Models are Convex-only — read the org's models from Convex, scope to the
  // selected ids (replaces the old `where:{id:{in},organizationId}`).
  const selected = new Set(modelIds);
  const models = (await getModelsByOrg(organizationId)).filter((m) => selected.has(m.id));

  const convex = await getConvexClient();
  const now = Date.now();
  for (const model of models) {
    const current = Number((model as Record<string, unknown>)[rateType] ?? 0);
    let newRate: number;

    switch (operation) {
      case "set":
        newRate = value;
        break;
      case "multiply":
        newRate = current * value;
        break;
      case "increase_percent":
        newRate = current * (1 + value / 100);
        break;
    }

    newRate = Math.round(newRate * 100) / 100;

    const patch: Record<string, number> = { [rateType]: newRate, updatedAt: now };
    // Auto-sync defaultRentalPrice when dailyRate changes
    if (rateType === "dailyRate") {
      patch.defaultRentalPrice = newRate;
    }

    await convex.mutation(api.models.update, { id: model.id, patch });
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: modelIds[0],
    entityName: `${models.length} models`,
    summary: `Bulk updated ${rateType} on ${models.length} model(s): ${operation} ${value}`,
  });

  return serialize({ count: models.length });
}
