"use server";

import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getProjectsByOrg } from "@/lib/projects-read";
import { bulkAssetSchema, type BulkAssetFormValues } from "@/lib/validations/asset";
import type { Prisma } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { reserveAssetTags } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import { getModelWithCategoryMap, type ModelWithCategory } from "@/lib/models-read";
import { getLocationMap, type ConvexLocation } from "@/lib/locations-read";
import {
  getMappedBulkAssetsByOrg,
  filterBulkAssets,
  sortBulkAssets,
  paginate,
  getBulkAssetById,
  getBulkAssetByAssetTag,
  mapConvexBulkAssetToPrisma,
} from "@/lib/assets-read";
import { createId } from "@paralleldrive/cuid2";
import { UserFacingError } from "@/lib/errors";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

// model (+ nested equipment category) + location live in Convex (dual-written) —
// attached from the maps below, not Prisma joins. Sorts/filters on model.name /
// location.name / model.categoryId stay on the always-fresh Prisma mirror.
export type BulkAssetWithRelations = Prisma.BulkAssetGetPayload<{ include: Record<string, never> }> & {
  model: ModelWithCategory | null;
  location: ConvexLocation | null;
};

export async function getBulkAssets(params?: {
  search?: string;
  categoryId?: string;
  status?: string;
  locationId?: string;
  modelId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();
  const {
    search, categoryId, status, locationId, modelId,
    isActive = true, page = 1, pageSize = 25,
    sortBy = "assetTag", sortOrder = "asc",
  } = params || {};

  // Bulk-asset rows + model/location maps all come from Convex (dual-written).
  // The org's full row set is fetched then filtered/sorted/paginated in JS,
  // replicating the old Prisma where/orderBy. See src/lib/assets-read.ts.
  const [allBulk, modelMap, locationMap] = await Promise.all([
    getMappedBulkAssetsByOrg(organizationId),
    getModelWithCategoryMap(organizationId),
    getLocationMap(organizationId),
  ]);
  const modelNameFor = (id: string) => modelMap.get(id)?.name;
  const categoryFor = (id: string) => modelMap.get(id)?.categoryId;
  const locationNameFor = (id: string | null) => (id ? locationMap.get(id)?.name : null);

  const filtered = filterBulkAssets(
    allBulk,
    { search, categoryId, status, locationId, modelId, isActive },
    modelNameFor,
    categoryFor,
  );
  const total = filtered.length;
  const sorted = sortBulkAssets(filtered, sortBy, sortOrder, modelNameFor, locationNameFor);
  const pageRows = paginate(sorted, page, pageSize);

  const withRelations = pageRows.map((b) => ({
    ...b,
    model: b.modelId ? modelMap.get(b.modelId) ?? null : null,
    location: b.locationId ? locationMap.get(b.locationId) ?? null : null,
  }));

  return serialize({ bulkAssets: withRelations, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function getBulkAsset(id: string) {
  const { organizationId } = await getOrgContext();

  // Base bulk asset (bulkAsset table is Convex-only now — Phase C mega-flip).
  const bulkDoc = await getBulkAssetById(id);
  if (!bulkDoc || bulkDoc.organizationId !== organizationId) return serialize(null);
  const bulkAsset = mapConvexBulkAssetToPrisma(bulkDoc);

  const convex = await getConvexClient();

  // Composite sub-reads — all from Convex. There's no listByBulkAssetId for
  // projectLineItems, so fetch the org list and filter by bulkAssetId in JS.
  const [lineItemDocs, scanLogDocs, testTagDocs] = await Promise.all([
    convex.query(api.projectLineItems.list, { orgId: organizationId }),
    convex.query(api.assetScanLogs.list, { orgId: organizationId }),
    convex.query(api.testTagAssets.list, { orgId: organizationId }),
  ]);

  const [modelMap, locationMap, projects] = await Promise.all([
    getModelWithCategoryMap(organizationId),
    getLocationMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  // ── lineItems (createdAt desc, take 20) + project ──
  const lineItems = lineItemDocs
    .filter((li) => li.bulkAssetId === id)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 20)
    .map((li) => {
      const project = li.projectId ? projectMap.get(li.projectId) ?? null : null;
      return {
        ...li,
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
  //    project joins; doc's scannedById / projectId are retained. ──
  const scanLogs = scanLogDocs
    .filter((s) => s.bulkAssetId === id)
    .sort((a, b) => (b.scannedAt ?? 0) - (a.scannedAt ?? 0))
    .slice(0, 20)
    .map((s) => ({
      ...s,
      scannedAt: s.scannedAt != null ? new Date(s.scannedAt) : null,
    }));

  // ── testTagAssets (testTagId asc) ──
  const testTagAssets = testTagDocs
    .filter((t) => t.bulkAssetId === id)
    .sort((a, b) => (a.testTagId < b.testTagId ? -1 : a.testTagId > b.testTagId ? 1 : 0))
    .map((t) => ({
      id: t.id,
      testTagId: t.testTagId,
      status: t.status ?? null,
      lastTestDate: t.lastTestDate != null ? new Date(t.lastTestDate) : null,
      nextDueDate: t.nextDueDate != null ? new Date(t.nextDueDate) : null,
    }));

  return serialize({
    ...bulkAsset,
    lineItems,
    scanLogs,
    testTagAssets,
    model: bulkAsset.modelId ? modelMap.get(bulkAsset.modelId) ?? null : null,
    location: bulkAsset.locationId ? locationMap.get(bulkAsset.locationId) ?? null : null,
  });
}

export async function createBulkAsset(data: BulkAssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("bulkAsset", "create");
  const parsed = bulkAssetSchema.parse(data);
  try {
    // DUP GUARD: Convex has no unique index.
    const dup = await getBulkAssetByAssetTag(organizationId, parsed.assetTag);
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
    await convex.mutation(api.bulkAssets.create, {
      id: newId,
      organizationId,
      modelId: parsed.modelId,
      assetTag: parsed.assetTag,
      totalQuantity: parsed.totalQuantity,
      availableQuantity: parsed.totalQuantity,
      purchasePricePerUnit: parsed.purchasePricePerUnit != null ? Number(parsed.purchasePricePerUnit) : undefined,
      locationId: parsed.locationId || undefined,
      status: parsed.status,
      notes: parsed.notes || undefined,
      isActive: parsed.isActive,
      tags: parsed.tags || undefined,
      createdAt: now,
      updatedAt: now,
    });
    const created = await getBulkAssetById(newId);
    if (!created) throw new Error("Bulk asset create read-back failed: " + newId);
    const result = mapConvexBulkAssetToPrisma(created);
    await reserveAssetTags(1);

    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CREATE",
      entityType: "bulkAsset",
      entityId: result.id,
      entityName: result.assetTag,
      summary: `Created bulk asset ${result.assetTag}`,
      details: { created: { assetTag: result.assetTag, totalQuantity: parsed.totalQuantity } },
    });

    return serialize(result);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      throw new Error(`Asset tag "${parsed.assetTag}" already exists`);
    }
    throw e;
  }
}

export async function updateBulkAsset(id: string, data: BulkAssetFormValues) {
  const { organizationId, userId, userName } = await requirePermission("bulkAsset", "update");
  const parsed = bulkAssetSchema.parse(data);

  const existingDoc = await getBulkAssetById(id);
  if (!existingDoc || existingDoc.organizationId !== organizationId) throw new Error("Bulk asset not found");
  const existing = mapConvexBulkAssetToPrisma(existingDoc);

  // DUP GUARD only when the tag changed.
  if (parsed.assetTag !== existing.assetTag) {
    const dup = await getBulkAssetByAssetTag(organizationId, parsed.assetTag);
    if (dup && dup.id !== id) {
      throw new UserFacingError({
        code: "DUPLICATE_ASSET_TAG",
        title: "Duplicate asset tag",
        message: `Asset tag "${parsed.assetTag}" already exists.`,
        hint: "Use a different asset tag.",
      });
    }
  }

  // Adjust available quantity based on total change
  const totalDiff = parsed.totalQuantity - existing.totalQuantity;
  const newAvailable = Math.max(0, existing.availableQuantity + totalDiff);

  const set: Record<string, unknown> = {
    modelId: parsed.modelId,
    assetTag: parsed.assetTag,
    totalQuantity: parsed.totalQuantity,
    availableQuantity: newAvailable,
    status: parsed.status,
    isActive: parsed.isActive,
    tags: parsed.tags ?? [],
    updatedAt: Date.now(),
  };
  const clear: string[] = [];
  if (parsed.purchasePricePerUnit != null) set.purchasePricePerUnit = Number(parsed.purchasePricePerUnit);
  else clear.push("purchasePricePerUnit");
  if (parsed.locationId) set.locationId = parsed.locationId;
  else clear.push("locationId");
  if (parsed.notes) set.notes = parsed.notes;
  else clear.push("notes");

  const convex = await getConvexClient();
  await convex.mutation(api.bulkAssets.patchBulkAsset, { id, set, clear });
  const updatedDoc = await getBulkAssetById(id);
  if (!updatedDoc) throw new Error("Bulk asset update read-back failed: " + id);
  const updated = mapConvexBulkAssetToPrisma(updatedDoc);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "bulkAsset",
    entityId: updated.id,
    entityName: updated.assetTag,
    summary: `Updated bulk asset ${updated.assetTag}`,
  });

  return serialize(updated);
}

export async function deleteBulkAsset(id: string) {
  const { organizationId, userId, userName } = await requirePermission("bulkAsset", "delete");

  const convex = await getConvexClient();
  const assetDoc = await getBulkAssetById(id);
  if (!assetDoc || assetDoc.organizationId !== organizationId) throw new Error("Bulk asset not found");
  const asset = mapConvexBulkAssetToPrisma(assetDoc);

  // No dedicated by-bulkAssetId Convex queries — filter the org-wide lists in JS
  // (same pattern as assets-read), replicating the Prisma _count guards.
  const lineItemCount = (await convex.query(api.projectLineItems.list, { orgId: organizationId }))
    .filter((li) => li.bulkAssetId === id).length;
  if (lineItemCount > 0) {
    throw new Error("Cannot delete — this bulk asset is referenced by project line items. Archive it instead.");
  }
  const kitBulkCount = (await convex.query(api.kitBulkItems.list, { orgId: organizationId }))
    .filter((ki) => ki.bulkAssetId === id).length;
  if (kitBulkCount > 0) {
    throw new Error("Cannot delete — this bulk asset is part of a kit. Remove it from the kit first.");
  }

  await convex.mutation(api.bulkAssets.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "bulkAsset",
    entityId: id,
    entityName: asset.assetTag,
    summary: `Deleted bulk asset ${asset.assetTag}`,
    details: { deleted: { assetTag: asset.assetTag } },
  });

  return { id };
}

export async function updateBulkAssetNotes(id: string, notes: string) {
  const { organizationId } = await requirePermission("bulkAsset", "update");
  const convex = await getConvexClient();
  if (notes) {
    await convex.mutation(api.bulkAssets.patchBulkAsset, {
      id,
      set: { notes, updatedAt: Date.now() },
      clear: [],
    });
  } else {
    await convex.mutation(api.bulkAssets.patchBulkAsset, {
      id,
      set: { updatedAt: Date.now() },
      clear: ["notes"],
    });
  }
  const updatedDoc = await getBulkAssetById(id);
  if (!updatedDoc || updatedDoc.organizationId !== organizationId) {
    throw new Error("Bulk asset notes update read-back failed: " + id);
  }
  return serialize(mapConvexBulkAssetToPrisma(updatedDoc));
}

export async function archiveBulkAsset(id: string) {
  const { organizationId } = await requirePermission("bulkAsset", "update");
  const convex = await getConvexClient();
  await convex.mutation(api.bulkAssets.patchBulkAsset, {
    id,
    set: { isActive: false, status: "RETIRED", updatedAt: Date.now() },
    clear: [],
  });
  const updatedDoc = await getBulkAssetById(id);
  if (!updatedDoc || updatedDoc.organizationId !== organizationId) {
    throw new Error("Bulk asset archive read-back failed: " + id);
  }
  return serialize(mapConvexBulkAssetToPrisma(updatedDoc));
}
