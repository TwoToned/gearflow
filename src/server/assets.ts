"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import type { Prisma } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { reserveAssetTags, getOrgTestTagSettings } from "@/server/settings";
import { backfillTestTagAssets } from "@/server/test-tag-assets";
import { logActivity } from "@/lib/activity-log";
import { getSupplierById } from "@/lib/suppliers-read";
import { getModelById, getModelWithCategoryMap, type ModelWithCategory } from "@/lib/models-read";
import { getLocationMap, type ConvexLocation } from "@/lib/locations-read";
import { getPrimaryPhotoMaps, getAssetMediaFromConvex, getModelMediaFromConvex, withResolvedFile } from "@/lib/media-read";
import { getMaintenanceRecordsByOrg } from "@/lib/maintenance-read";
import { type FilterValue } from "@/lib/table-utils";
import {
  getMappedAssetsByOrg,
  filterAssets,
  sortAssets,
  paginate,
  getAssetById,
  getAssetByAssetTag,
  getBulkAssetById,
  mapConvexAssetToPrisma,
} from "@/lib/assets-read";
import { translatePrismaError, UserFacingError } from "@/lib/errors";
import { validateCustomFieldValues } from "@/lib/validations/custom-field";
import { getActiveCustomFieldsForOrg } from "@/lib/custom-fields-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Validate + normalise asset custom-field values against the org's active
 * ASSET custom-field definitions. Throws UserFacingError on a required-field
 * miss or a bad value. Returns the normalised map (unknown keys dropped).
 */
async function resolveAssetCustomFields(
  organizationId: string,
  raw: Record<string, string> | null | undefined,
): Promise<Record<string, string>> {
  // Custom field definitions are Convex-only (custom-fields.ts writes Convex);
  // the Prisma table is frozen, so read the active ASSET defs from Convex.
  const defs = await getActiveCustomFieldsForOrg(organizationId, "ASSET");
  if (defs.length === 0) return {};
  try {
    return validateCustomFieldValues(defs, raw);
  } catch (e) {
    throw new UserFacingError({
      code: "CUSTOM_FIELD_INVALID",
      title: "Custom field problem",
      message: e instanceof Error ? e.message : "A custom field value is invalid.",
    });
  }
}

// model (+ nested equipment category) + location live in Convex (dual-written) —
// attached from the maps, not Prisma joins. Sorts/filters on model.name /
// location.name / model.categoryId stay on the always-fresh Prisma mirror.
export type AssetWithRelations = Prisma.AssetGetPayload<{ include: Record<string, never> }> & {
  model: ModelWithCategory | null;
  location: ConvexLocation | null;
};

export async function getAssets(params?: {
  search?: string;
  categoryId?: string;
  status?: string;
  condition?: string;
  locationId?: string;
  modelId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, FilterValue>;
}) {
  const { organizationId } = await getOrgContext();
  const {
    search, categoryId, status, condition, locationId, modelId,
    isActive = true, page = 1, pageSize = 25,
    sortBy = "assetTag", sortOrder = "asc",
    filters,
  } = params || {};

  // Extract the DataTable enum `in` filters (status/condition/locationId/
  // categoryId) and the tags hasSome filter from the raw filter map.
  const asArr = (v: FilterValue | undefined): string[] | undefined =>
    Array.isArray(v) && v.length > 0 ? (v as string[]) : undefined;

  // Asset rows + model/location maps all come from Convex (dual-written). The
  // org's full row set is fetched then filtered/sorted/paginated in JS,
  // replicating the old Prisma where/orderBy. See src/lib/assets-read.ts.
  const [allAssets, modelMap, locationMap] = await Promise.all([
    getMappedAssetsByOrg(organizationId),
    getModelWithCategoryMap(organizationId),
    getLocationMap(organizationId),
  ]);
  const modelNameFor = (id: string) => modelMap.get(id)?.name;
  const categoryFor = (id: string) => modelMap.get(id)?.categoryId;
  const locationNameFor = (id: string | null) => (id ? locationMap.get(id)?.name : null);

  const filtered = filterAssets(
    allAssets,
    {
      search, categoryId, status, condition, locationId, modelId, isActive,
      statusIn: asArr(filters?.status),
      conditionIn: asArr(filters?.condition),
      locationIdIn: asArr(filters?.locationId),
      categoryIdIn: asArr(filters?.categoryId),
      tagsHasSome: asArr(filters?.tags),
    },
    modelNameFor,
    categoryFor,
  );
  const total = filtered.length;
  const sorted = sortAssets(filtered, sortBy, sortOrder, modelNameFor, locationNameFor);
  const pageRows = paginate(sorted, page, pageSize);

  const withRelations = pageRows.map((a) => ({
    ...a,
    model: a.modelId ? modelMap.get(a.modelId) ?? null : null,
    location: a.locationId ? locationMap.get(a.locationId) ?? null : null,
  }));

  return serialize({ assets: withRelations, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function getAsset(id: string) {
  const { organizationId } = await getOrgContext();

  // Base asset (asset table is Convex-only now — Phase C mega-flip).
  const assetDoc = await getAssetById(id);
  if (!assetDoc || assetDoc.organizationId !== organizationId) return serialize(null);
  const asset = mapConvexAssetToPrisma(assetDoc);

  const convex = await getConvexClient();

  // Composite sub-reads — all from Convex (asset/projectLineItem/assetBulkChild
  // are Convex-only; media/maintenance/testTag/scanLog already mirrored).
  const [
    media,
    childAssetDocs,
    childBulkDocs,
    lineItemDocs,
    scanLogDocs,
    testTagDocs,
    maintenanceLinks,
    parentAssetDoc,
  ] = await Promise.all([
    getAssetMediaFromConvex(id),
    convex.query(api.assets.listByParentAssetId, { parentAssetId: id, orgId: organizationId }),
    convex.query(api.assetBulkChildren.listByParentAssetId, { parentAssetId: id, orgId: organizationId }),
    convex.query(api.projectLineItems.listByAssetId, { assetId: id, orgId: organizationId }),
    convex.query(api.assetScanLogs.listByOrgAndAsset, { orgId: organizationId, assetId: id }),
    convex.query(api.testTagAssets.listByAssetId, { assetId: id }),
    convex.query(api.maintenanceRecordAssets.listByAssetIds, { assetIds: [id] }),
    asset.parentAssetId ? getAssetById(asset.parentAssetId) : Promise.resolve(null),
  ]);

  // Line items are already asset-scoped (listByAssetId). Order + take 20 now so we
  // fetch ONLY the projects those rows reference — instead of getProjectsByOrg
  // (every project in the org) just to build a lookup map for ≤20 rows.
  const orderedLineItemDocs = [...lineItemDocs]
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 20);
  const lineProjectIds = [
    ...new Set(orderedLineItemDocs.map((li) => li.projectId).filter((p): p is string => !!p)),
  ];

  // Model (+ category) + supplier + referenced projects + maintenance records (Convex).
  // (maintenanceRecords stays org-wide for now — a by-asset scoped read is a follow-up.)
  const [modelMap, supplier, projects, maintenanceRecords] = await Promise.all([
    getModelWithCategoryMap(organizationId),
    asset.supplierId ? getSupplierById(asset.supplierId) : null,
    lineProjectIds.length
      ? convex.query(api.projects.listByIds, { orgId: organizationId, ids: lineProjectIds })
      : Promise.resolve([]),
    getMaintenanceRecordsByOrg(organizationId),
  ]);

  // Model media (gallery) + the model's bulk accessories — both Convex.
  const [modelMediaRows, modelBulkAccessoriesRaw] = await Promise.all([
    asset.modelId ? getModelMediaFromConvex(asset.modelId) : Promise.resolve([]),
    asset.modelId
      ? convex.query(api.modelBulkAccessories.listByModelId, { modelId: asset.modelId, organizationId })
      : Promise.resolve([]),
  ]);

  const assetModel = asset.modelId ? modelMap.get(asset.modelId) ?? null : null;

  // Gallery rows (asset_media / model_media) carry a nullable `file`; the prior
  // Prisma read had a non-null `file` join. Reshape to the page's MediaItem shape
  // (drop rows whose mirror file is missing — same as a broken join rendering empty).
  type MediaItemShape = {
    id: string;
    fileId: string;
    type: string;
    isPrimary: boolean;
    displayName: string | null;
    sortOrder: number;
    file: {
      id: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      url: string;
      thumbnailUrl: string | null;
    };
  };
  const toMediaItem = (
    m: { id: string; fileId: string; type: string; isPrimary: boolean; displayName: string | null; sortOrder: number; file: import("@/lib/media-read").GalleryFile | null },
  ): MediaItemShape | null =>
    m.file
      ? {
          id: m.id,
          fileId: m.fileId,
          type: m.type,
          isPrimary: m.isPrimary,
          displayName: m.displayName,
          sortOrder: m.sortOrder,
          file: {
            id: m.file.id,
            fileName: m.file.fileName,
            fileSize: m.file.fileSize,
            mimeType: m.file.mimeType,
            url: m.file.url,
            thumbnailUrl: m.file.thumbnailUrl,
          },
        }
      : null;
  const mediaItems = media.map(toMediaItem).filter((m): m is MediaItemShape => m != null);
  const modelMediaItems = modelMediaRows.map(toMediaItem).filter((m): m is MediaItemShape => m != null);

  // ── parentAsset (id/assetTag/customName) ──
  const parentAsset = parentAssetDoc
    ? { id: parentAssetDoc.id, assetTag: parentAssetDoc.assetTag, customName: parentAssetDoc.customName ?? null }
    : null;

  // ── childAssets (ordered by assetTag asc) + grafted model ──
  const childAssetsWithModel = childAssetDocs
    .map(mapConvexAssetToPrisma)
    .sort((a, b) => (a.assetTag < b.assetTag ? -1 : a.assetTag > b.assetTag ? 1 : 0))
    .map((child) => ({
      ...child,
      model: child.modelId ? modelMap.get(child.modelId) ?? null : null,
    }));

  // ── childBulkItems (ordered by sortOrder asc) + nested bulkAsset + model ──
  // assetBulkChildren docs carry only bulkAssetId — resolve each child's bulk
  // asset to recover assetTag / modelId (no denormalised columns on the join).
  const childBulkAssetDocs = await Promise.all(
    childBulkDocs.map((item) => getBulkAssetById(item.bulkAssetId)),
  );
  const childBulkAssetMap = new Map(
    childBulkAssetDocs.filter((d): d is NonNullable<typeof d> => d != null).map((d) => [d.id, d]),
  );
  const childBulkItemsWithModel = [...childBulkDocs]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((item) => {
      const ba = childBulkAssetMap.get(item.bulkAssetId) ?? null;
      const bulkModelId = ba?.modelId ?? null;
      return {
        id: item.id,
        organizationId: item.organizationId,
        parentAssetId: item.parentAssetId,
        bulkAssetId: item.bulkAssetId,
        quantity: item.quantity,
        allocationMode: (item.allocationMode ?? "SHIPS_WITH") as "SHIPS_WITH" | "DEDICATED",
        sortOrder: item.sortOrder ?? null,
        notes: item.notes ?? null,
        addedAt: item.addedAt ? new Date(item.addedAt) : null,
        addedById: item.addedById ?? null,
        bulkAsset: {
          id: item.bulkAssetId,
          assetTag: ba?.assetTag ?? "",
          modelId: bulkModelId,
          model: bulkModelId ? modelMap.get(bulkModelId) ?? null : null,
        },
      };
    });

  // ── lineItems (project history; createdAt desc, take 20) + project ──
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const lineItems = orderedLineItemDocs
    .map((li) => {
      const project = li.projectId ? projectMap.get(li.projectId) ?? null : null;
      return {
        ...li,
        status: li.status ?? "CONFIRMED",
        checkedOutAt: li.checkedOutAt != null ? new Date(li.checkedOutAt) : null,
        returnedAt: li.returnedAt != null ? new Date(li.returnedAt) : null,
        createdAt: li.createdAt != null ? new Date(li.createdAt) : null,
        updatedAt: li.updatedAt != null ? new Date(li.updatedAt) : null,
        project: project
          ? { ...project, name: project.name, projectNumber: project.projectNumber }
          : { name: "", projectNumber: "" },
      };
    });

  // ── scanLogs (scannedAt desc, take 20). No page consumer reads scannedBy /
  //    project joins; the scan-log doc's scannedById / projectId are retained. ──
  const scanLogs = [...scanLogDocs]
    .sort((a, b) => (b.scannedAt ?? 0) - (a.scannedAt ?? 0))
    .slice(0, 20)
    .map((s) => ({
      ...s,
      scannedAt: s.scannedAt != null ? new Date(s.scannedAt) : null,
    }));

  // ── testTagAsset (first) ──
  const tt = testTagDocs[0] ?? null;
  const testTagAsset = tt
    ? {
        id: tt.id,
        testTagId: tt.testTagId,
        status: tt.status ?? null,
        lastTestDate: tt.lastTestDate != null ? new Date(tt.lastTestDate) : null,
        nextDueDate: tt.nextDueDate != null ? new Date(tt.nextDueDate) : null,
        testIntervalMonths: tt.testIntervalMonths ?? null,
      }
    : null;

  // ── maintenanceLinks (maintenanceRecord.createdAt desc, take 20) ──
  const maintenanceRecordMap = new Map(maintenanceRecords.map((m) => [m.id, m]));
  const maintenanceLinksMapped = maintenanceLinks
    .map((link) => ({
      ...link,
      maintenanceRecord: maintenanceRecordMap.get(link.maintenanceRecordId) ?? null,
    }))
    .filter((l): l is typeof l & { maintenanceRecord: NonNullable<typeof l.maintenanceRecord> } => l.maintenanceRecord != null)
    .sort((a, b) => b.maintenanceRecord.createdAt.getTime() - a.maintenanceRecord.createdAt.getTime())
    .slice(0, 20);

  const bulkAccessoriesWithModel = modelBulkAccessoriesRaw.map((ba) => ({
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
  }));

  // Location FK was dropped (Phase B); attach `location` from the Convex mirror.
  const location = asset.locationId
    ? (await getLocationMap(organizationId)).get(asset.locationId) ?? null
    : null;

  return serialize({
    ...asset,
    media: mediaItems,
    maintenanceLinks: maintenanceLinksMapped,
    scanLogs,
    lineItems,
    testTagAsset,
    parentAsset,
    location,
    model: assetModel
      ? { ...assetModel, media: modelMediaItems, bulkAccessories: bulkAccessoriesWithModel }
      : null,
    childAssets: childAssetsWithModel,
    childBulkItems: childBulkItemsWithModel,
    supplier,
  });
}

/**
 * Primary photos for the reactive registry table. Both maps now come off the
 * Convex `assetMedia` / `modelMedia` + `fileUploads` mirror via getPrimaryPhotoMap
 * (Phase 6 decommission — those tables are now dual-written). Returns two maps:
 * per-assetId (the asset's own primary photo) and per-modelId (the model's
 * primary photo, used as a fallback). The reactive table subscribes to
 * assets/bulkAssets via Convex and merges these (non-reactive) photos in:
 * photo = assetPhotos[a.id] ?? modelPhotos[a.modelId]. Model name / category /
 * location resolve from the Convex models/categories/locations the table already
 * loads.
 */
export async function getAssetRegistryPhotos(): Promise<{
  assetPhotos: Record<string, { url: string | null; thumbnailUrl: string | null }>;
  modelPhotos: Record<string, { url: string | null; thumbnailUrl: string | null }>;
}> {
  const { organizationId } = await getOrgContext();
  // One shared fileUploads collect for both maps (asset + model).
  const maps = await getPrimaryPhotoMaps(["asset", "model"], organizationId);
  return serialize({ assetPhotos: maps.asset, modelPhotos: maps.model });
}

export async function createAsset(data: AssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("asset", "create");
  const parsed = assetSchema.parse(data);

  // Validate custom fields against org definitions before persisting.
  const customFieldValues = await resolveAssetCustomFields(
    organizationId,
    parsed.customFieldValues,
  );

  // Model lives in Convex — fetch for T&T requirements check.
  const model = await getModelById(parsed.modelId);

  try {
    // DUP GUARD: Convex has no unique index — reject a duplicate tag up front.
    const dup = await getAssetByAssetTag(organizationId, parsed.assetTag);
    if (dup) {
      throw new UserFacingError({
        code: "DUPLICATE_ASSET_TAG",
        title: "Duplicate asset tag",
        message: `Asset tag "${parsed.assetTag}" already exists.`,
        hint: "Use a different asset tag.",
      });
    }

    const convex = await getConvexClient();
    const newId = createId();
    const now = Date.now();
    await convex.mutation(api.assets.create, {
      id: newId,
      organizationId,
      modelId: parsed.modelId,
      assetTag: parsed.assetTag,
      serialNumber: parsed.serialNumber || undefined,
      customName: parsed.customName || undefined,
      status: parsed.status,
      condition: parsed.condition,
      purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate).getTime() : undefined,
      purchasePrice: parsed.purchasePrice != null ? Number(parsed.purchasePrice) : undefined,
      purchaseSupplier: parsed.purchaseSupplier || undefined,
      supplierId: parsed.supplierId || undefined,
      purchaseOrderNumber: parsed.purchaseOrderNumber || undefined,
      warrantyExpiry: parsed.warrantyExpiry ? new Date(parsed.warrantyExpiry).getTime() : undefined,
      notes: parsed.notes || undefined,
      locationId: parsed.locationId || undefined,
      customFieldValues,
      barcode: parsed.barcode || parsed.assetTag,
      qrCode: parsed.assetTag,
      images: parsed.images || undefined,
      isActive: parsed.isActive,
      tags: parsed.tags || undefined,
      createdAt: now,
      updatedAt: now,
    });
    // Read back the persisted row in the Prisma shape callers expect.
    const created = await getAssetById(newId);
    if (!created) throw new Error("Asset create read-back failed: " + newId);
    const result = mapConvexAssetToPrisma(created);
    // Advance the counter now that the asset is actually created
    await reserveAssetTags(1);

    // Auto-register in T&T registry if model requires it (Convex-only write).
    if (model?.requiresTestAndTag) {
      const orgTT = await getOrgTestTagSettings();
      const intervalMonths = model.testAndTagIntervalDays
        ? Math.max(1, Math.round(model.testAndTagIntervalDays / 30))
        : (orgTT.defaultIntervalMonths || 3);
      const convexForTT = await getConvexClient();
      const ttNow = Date.now();
      await convexForTT.mutation(api.testTagAssets.createIfMissing, {
        id: createId(),
        organizationId,
        testTagId: parsed.assetTag,
        description: `${model.manufacturer ? model.manufacturer + " " : ""}${model.name} (${parsed.assetTag})`,
        equipmentClass: (model.defaultEquipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
        applianceType: (model.defaultApplianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
        ...(model.manufacturer && { make: model.manufacturer }),
        ...(model.modelNumber && { modelName: model.modelNumber }),
        ...(parsed.serialNumber && { serialNumber: parsed.serialNumber }),
        testIntervalMonths: intervalMonths,
        status: "NOT_YET_TESTED",
        assetId: result.id,
        isActive: true,
        createdAt: ttNow,
        updatedAt: ttNow,
      });
    }

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "asset",
      entityId: result.id,
      entityName: result.assetTag,
      summary: `Created asset ${result.assetTag}`,
      details: { created: { assetTag: result.assetTag, modelId: parsed.modelId } },
      assetId: result.id,
    });

    return serialize(result);
  } catch (e: unknown) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
}

export async function createAssets(
  data: AssetFormValues,
  assets: { tag: string; serialNumber?: string }[],
) {
  const { organizationId, userId, userName } = await requirePermission("asset", "create");
  const parsed = assetSchema.parse(data);

  // All assets in a bulk create share the same form data → one validation.
  const customFieldValues = await resolveAssetCustomFields(
    organizationId,
    parsed.customFieldValues,
  );

  // Model lives in Convex — fetch for T&T requirements check.
  const model = await getModelById(parsed.modelId);

  let results;
  try {
    const convex = await getConvexClient();
    const now = Date.now();
    const createdRows = [];
    for (const { tag, serialNumber } of assets) {
      // DUP GUARD per tag (no Convex unique index).
      const dup = await getAssetByAssetTag(organizationId, tag);
      if (dup) {
        throw new UserFacingError({
          code: "DUPLICATE_ASSET_TAG",
          title: "Duplicate asset tag",
          message: `Asset tag "${tag}" already exists.`,
          hint: "Use a different asset tag.",
        });
      }
      const newId = createId();
      await convex.mutation(api.assets.create, {
        id: newId,
        organizationId,
        modelId: parsed.modelId,
        assetTag: tag,
        serialNumber: serialNumber || parsed.serialNumber || undefined,
        customName: parsed.customName || undefined,
        status: parsed.status,
        condition: parsed.condition,
        purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate).getTime() : undefined,
        purchasePrice: parsed.purchasePrice != null ? Number(parsed.purchasePrice) : undefined,
        purchaseSupplier: parsed.purchaseSupplier || undefined,
        supplierId: parsed.supplierId || undefined,
        warrantyExpiry: parsed.warrantyExpiry ? new Date(parsed.warrantyExpiry).getTime() : undefined,
        notes: parsed.notes || undefined,
        locationId: parsed.locationId || undefined,
        customFieldValues,
        barcode: parsed.barcode || tag,
        qrCode: tag,
        images: parsed.images || undefined,
        isActive: parsed.isActive,
        tags: parsed.tags || undefined,
        createdAt: now,
        updatedAt: now,
      });
      const created = await getAssetById(newId);
      if (!created) throw new Error("Asset create read-back failed: " + newId);
      createdRows.push(mapConvexAssetToPrisma(created));
    }
    results = createdRows;
  } catch (e: unknown) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }

  // Advance the counter now that assets are actually created
  await reserveAssetTags(assets.length);

  // Auto-register in T&T registry if model requires it (Convex-only write).
  if (model?.requiresTestAndTag) {
    const orgTT = await getOrgTestTagSettings();
    const intervalMonths = model.testAndTagIntervalDays
      ? Math.max(1, Math.round(model.testAndTagIntervalDays / 30))
      : (orgTT.defaultIntervalMonths || 3);
    const convexForTT = await getConvexClient();
    const ttNow = Date.now();
    for (const asset of results) {
      await convexForTT.mutation(api.testTagAssets.createIfMissing, {
        id: createId(),
        organizationId,
        testTagId: asset.assetTag,
        description: `${model.manufacturer ? model.manufacturer + " " : ""}${model.name} (${asset.assetTag})`,
        equipmentClass: (model.defaultEquipmentClass as "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY") || "CLASS_I",
        applianceType: (model.defaultApplianceType as "APPLIANCE" | "CORD_SET" | "EXTENSION_LEAD" | "POWER_BOARD" | "RCD_PORTABLE" | "RCD_FIXED" | "THREE_PHASE" | "OTHER") || "APPLIANCE",
        ...(model.manufacturer && { make: model.manufacturer }),
        ...(model.modelNumber && { modelName: model.modelNumber }),
        ...(asset.serialNumber && { serialNumber: asset.serialNumber }),
        testIntervalMonths: intervalMonths,
        status: "NOT_YET_TESTED",
        assetId: asset.id,
        isActive: true,
        createdAt: ttNow,
        updatedAt: ttNow,
      });
    }
  }

  for (const result of results) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "asset",
      entityId: result.id,
      entityName: result.assetTag,
      summary: `Created asset ${result.assetTag}`,
      details: { created: { assetTag: result.assetTag, modelId: parsed.modelId } },
      assetId: result.id,
    });
  }

  return serialize(results);
}

export async function updateAsset(id: string, data: AssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("asset", "update");
  const parsed = assetSchema.parse(data);

  const customFieldValues = await resolveAssetCustomFields(
    organizationId,
    parsed.customFieldValues,
  );

  const beforeDoc = await getAssetById(id);
  if (!beforeDoc) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Asset not found",
      message: "This asset was deleted or moved. Refresh the page to see the latest state.",
    });
  }
  const before = mapConvexAssetToPrisma(beforeDoc);

  let updated;
  try {
    // DUP GUARD only when the tag changed.
    if (parsed.assetTag !== before.assetTag) {
      const dup = await getAssetByAssetTag(organizationId, parsed.assetTag);
      if (dup && dup.id !== id) {
        throw new UserFacingError({
          code: "DUPLICATE_ASSET_TAG",
          title: "Duplicate asset tag",
          message: `Asset tag "${parsed.assetTag}" already exists.`,
          hint: "Use a different asset tag.",
        });
      }
    }

    // set = provided non-null fields; clear = optional fields being unset.
    const set: Record<string, unknown> = {
      modelId: parsed.modelId,
      assetTag: parsed.assetTag,
      status: parsed.status,
      condition: parsed.condition,
      customFieldValues,
      barcode: parsed.barcode || parsed.assetTag,
      isActive: parsed.isActive,
      tags: parsed.tags ?? [],
      images: parsed.images ?? [],
      updatedAt: Date.now(),
    };
    const clear: string[] = [];
    const setOrClear = (field: string, value: unknown) => {
      if (value == null || value === "") clear.push(field);
      else set[field] = value;
    };
    setOrClear("serialNumber", parsed.serialNumber);
    setOrClear("customName", parsed.customName);
    setOrClear("purchaseDate", parsed.purchaseDate ? new Date(parsed.purchaseDate).getTime() : null);
    setOrClear("purchasePrice", parsed.purchasePrice != null ? Number(parsed.purchasePrice) : null);
    setOrClear("purchaseSupplier", parsed.purchaseSupplier);
    setOrClear("supplierId", parsed.supplierId);
    setOrClear("warrantyExpiry", parsed.warrantyExpiry ? new Date(parsed.warrantyExpiry).getTime() : null);
    setOrClear("notes", parsed.notes);
    setOrClear("locationId", parsed.locationId);

    const convex = await getConvexClient();
    await convex.mutation(api.assets.patchAsset, { id, set, clear });
    const updatedDoc = await getAssetById(id);
    if (!updatedDoc) throw new Error("Asset update read-back failed: " + id);
    updated = mapConvexAssetToPrisma(updatedDoc);
  } catch (e: unknown) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: updated.id,
    entityName: updated.assetTag,
    summary: `Updated asset ${updated.assetTag}`,
    assetId: updated.id,
  });

  // Register in T&T if model requires it and not already registered
  // Model lives in Convex — fetch for T&T requirements check.
  const model = await getModelById(parsed.modelId);
  if (model?.requiresTestAndTag) {
    await backfillTestTagAssets();
  }

  return serialize(updated);
}

export async function bulkUpdateAssets(
  ids: string[],
  data: {
    status?: string;
    condition?: string;
    locationId?: string | null;
  },
) {
  const { organizationId } = await requirePermission("asset", "update");
  if (ids.length === 0) {
    throw new UserFacingError({
      code: "NO_SELECTION",
      title: "Nothing selected",
      message: "Select at least one asset before applying a bulk change.",
    });
  }

  const set: Record<string, unknown> = {};
  const clear: string[] = [];
  if (data.status) set.status = data.status;
  if (data.condition) set.condition = data.condition;
  if (data.locationId !== undefined) {
    if (data.locationId) set.locationId = data.locationId;
    else clear.push("locationId");
  }

  if (Object.keys(set).length === 0 && clear.length === 0) {
    throw new UserFacingError({
      code: "NO_CHANGES",
      title: "No changes specified",
      message: "Pick a field to change (status, condition, or location) before applying.",
    });
  }

  set.updatedAt = Date.now();
  const convex = await getConvexClient();
  const count = await convex.mutation(api.assets.bulkUpdate, {
    organizationId,
    ids,
    set,
    clear: clear.length > 0 ? clear : undefined,
  });

  return { count };
}

export async function deleteAsset(id: string) {
  const { organizationId, userId, userName } = await requirePermission("asset", "delete");

  const convex = await getConvexClient();
  const assetDoc = await getAssetById(id);
  if (!assetDoc || assetDoc.organizationId !== organizationId) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Asset not found",
      message: "This asset was deleted or moved. Refresh the page to see the latest state.",
    });
  }
  const asset = mapConvexAssetToPrisma(assetDoc);

  const lineItemCount = (await convex.query(api.projectLineItems.listByAssetId, { assetId: id, orgId: organizationId })).length;
  if (lineItemCount > 0) {
    throw new UserFacingError({
      code: "ASSET_IN_USE",
      title: "Cannot delete",
      message: "This asset is referenced by project line items.",
      hint: "Archive it instead so the history stays intact.",
    });
  }
  const kitMembership = await convex.query(api.kitSerializedItems.getByAssetId, { assetId: id, orgId: organizationId });
  if (kitMembership) {
    throw new UserFacingError({
      code: "ASSET_IN_KIT",
      title: "Cannot delete",
      message: "This asset is part of a kit.",
      hint: "Remove it from the kit first, then delete.",
    });
  }
  // Deleting a parent would silently orphan/destroy its accessories
  // (serialised children SetNull, bulk-child rows cascade). Block it.
  const childAssetCount = (await convex.query(api.assets.listByParentAssetId, { parentAssetId: id, orgId: organizationId })).length;
  const childBulkCount = (await convex.query(api.assetBulkChildren.listByParentAssetId, { parentAssetId: id, orgId: organizationId })).length;
  if (childAssetCount > 0 || childBulkCount > 0) {
    throw new UserFacingError({
      code: "ASSET_HAS_ACCESSORIES",
      title: "Cannot delete",
      message: "This asset has accessories attached.",
      hint: "Detach its accessories first, then delete.",
    });
  }

  // Retire linked T&T entry if one exists (Convex-only write).
  const linkedTTList = await convex.query(api.testTagAssets.listByAssetId, { assetId: id });
  for (const linkedTT of linkedTTList) {
    await convex.mutation(api.testTagAssets.update, {
      id: linkedTT.id,
      patch: { status: "RETIRED", isActive: false, updatedAt: Date.now() },
    });
  }

  await convex.mutation(api.assets.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "asset",
    entityId: id,
    entityName: asset.assetTag,
    summary: `Deleted asset ${asset.assetTag}`,
    details: { deleted: { assetTag: asset.assetTag } },
  });

  return { id };
}

export async function updateAssetNotes(id: string, notes: string) {
  const { organizationId } = await requirePermission("asset", "update");
  const convex = await getConvexClient();
  if (notes) {
    await convex.mutation(api.assets.patchAsset, {
      id,
      set: { notes, updatedAt: Date.now() },
      clear: [],
    });
  } else {
    await convex.mutation(api.assets.patchAsset, {
      id,
      set: { updatedAt: Date.now() },
      clear: ["notes"],
    });
  }
  const updatedDoc = await getAssetById(id);
  if (!updatedDoc || updatedDoc.organizationId !== organizationId) {
    throw new Error("Asset notes update read-back failed: " + id);
  }
  return serialize(mapConvexAssetToPrisma(updatedDoc));
}

export async function archiveAsset(id: string) {
  const { organizationId } = await requirePermission("asset", "update");

  // Retire linked T&T entries (Convex-only write).
  const convex = await getConvexClient();
  const linkedTTList = await convex.query(api.testTagAssets.listByAssetId, { assetId: id });
  const archiveNow = Date.now();
  for (const tt of linkedTTList) {
    await convex.mutation(api.testTagAssets.update, {
      id: tt.id,
      patch: { status: "RETIRED", isActive: false, updatedAt: archiveNow },
    });
  }

  await convex.mutation(api.assets.patchAsset, {
    id,
    set: { isActive: false, status: "RETIRED", updatedAt: archiveNow },
    clear: [],
  });
  const updatedDoc = await getAssetById(id);
  if (!updatedDoc || updatedDoc.organizationId !== organizationId) {
    throw new Error("Asset archive read-back failed: " + id);
  }
  return serialize(mapConvexAssetToPrisma(updatedDoc));
}
