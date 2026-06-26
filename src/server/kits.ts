"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  kitSchema,
  kitSerializedItemSchema,
  kitBulkItemSchema,
  type KitFormValues,
  type KitSerializedItemFormValues,
  type KitBulkItemFormValues,
} from "@/lib/validations/kit";
import { serialize } from "@/lib/serialize";
import { reserveAssetTags } from "@/server/settings";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

import { getPrimaryPhotoMap, getKitMediaFromConvex, withResolvedFile } from "@/lib/media-read";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getLocationMap } from "@/lib/locations-read";
import { getCategoryMap } from "@/lib/categories-read";
import { mapLineItemDoc } from "@/lib/project-line-item-read";
import { getAssetById, getBulkAssetById, getAssetsByOrg, getBulkAssetsByOrg, filterAvailableAssetsForKit, filterAvailableBulkAssetsForKit, sortByAssetTagAsc, mapConvexAssetToPrisma, mapConvexBulkAssetToPrisma } from "@/lib/assets-read";
import { getKitSerializedItemsByOrg, getKitBulkItemsByOrg, countKitMembers, getKitById, getKitByAssetTag, coerceKitDeletabilityRow, computeKitDeletability } from "@/lib/kits-read";
import { getMaintenanceRecordsByOrg } from "@/lib/maintenance-read";

/**
 * Per-kit member-item counts + primary photo (kitId -> meta).
 * Cross-domain for the counts (kit member tables come off the fresh Prisma
 * mirror); the primary photo comes off the Convex `kitMedia` + `fileUploads`
 * mirror via getPrimaryPhotoMap (Phase 6 decommission — kit_media is now
 * dual-written). Used by the reactive kit table, which subscribes to the kit
 * list via Convex and merges these (non-reactive) values in. Excludes prep-kits
 * (isPrep) to match the kit list.
 *
 * Phase A: the member counts now come off the dual-written Convex
 * `kitSerializedItems` / `kitBulkItems` lists (counted in JS by countKitMembers)
 * instead of two Prisma `groupBy`s; the primary photo already came from Convex.
 */
export async function getKitCounts(): Promise<
  Record<string, { serializedItems: number; bulkItems: number; media: { url: string | null; thumbnailUrl: string | null } | null }>
> {
  const { organizationId } = await getOrgContext();
  const [serializedItems, bulkItems, photoMap] = await Promise.all([
    getKitSerializedItemsByOrg(organizationId),
    getKitBulkItemsByOrg(organizationId),
    getPrimaryPhotoMap("kit", organizationId),
  ]);
  const memberCounts = countKitMembers(serializedItems, bulkItems);
  const out: Record<string, { serializedItems: number; bulkItems: number; media: { url: string | null; thumbnailUrl: string | null } | null }> = {};
  const ensure = (id: string) => (out[id] ??= { serializedItems: 0, bulkItems: 0, media: null });
  for (const [kitId, c] of Object.entries(memberCounts)) {
    const e = ensure(kitId);
    e.serializedItems = c.serializedItems;
    e.bulkItems = c.bulkItems;
  }
  for (const [kitId, meta] of Object.entries(photoMap)) ensure(kitId).media = meta;
  return serialize(out);
}

// Single kit with all relations.
//
// The kit row + its serialized/bulk members + the members' assets/bulk-assets
// are now Convex-only (read off the dual-written mirror). The remaining
// relations (lineItems, scanLogs, maintenanceRecords, media) still live in
// Prisma — those tables haven't migrated yet — so they're queried directly by
// kitId rather than traversed off a Prisma Kit row.
export async function getKit(id: string) {
  const { organizationId } = await getOrgContext();

  const kit = await getKitById(id);
  if (!kit || kit.organizationId !== organizationId) return serialize(null);

  // Wave 1 — the kit's members + per-kit relations, each read SCOPED to this kit
  // (was: collect the whole org's serialized items / bulk items / asset registry /
  // bulk assets / scan logs / projects and JS-filter to this kit — the "smoking
  // gun" O(org inventory) read on the hottest detail path). These return the same
  // raw Convex doc shapes the org-wide `list` queries did, so all downstream
  // mapping is unchanged — only the row SET narrows to this kit.
  const convex = await getConvexClient();
  const [serialized, bulk, modelMap, lineItemRows, scanLogRows, maintenanceRecords, media] =
    await Promise.all([
      convex.query(api.kitSerializedItems.listByKitId, { orgId: organizationId, kitId: id }),
      convex.query(api.kitBulkItems.listByKitId, { orgId: organizationId, kitId: id }),
      getModelMap(organizationId),
      convex
        .query(api.projectLineItems.listByKitId, { kitId: id, orgId: organizationId })
        .then((rows) => rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 20)),
      // assetScanLog scoped to this kit (by_kitId), then orderBy scannedAt desc + take 20.
      convex
        .query(api.assetScanLogs.listByKitId, { orgId: organizationId, kitId: id })
        .then((rows) => rows.sort((a, b) => (b.scannedAt ?? 0) - (a.scannedAt ?? 0)).slice(0, 20)),
      // maintenanceRecord stays org-wide-then-filtered for now (smaller table; a
      // by-kit scoped read is a follow-up). Replicates orderBy createdAt desc + take 20.
      getMaintenanceRecordsByOrg(organizationId).then((records) =>
        records
          .filter((m) => m.kitId === id)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 20),
      ),
      // kit media gallery now from the Convex mirror (dual-written → identical data).
      getKitMediaFromConvex(id),
    ]);

  // Wave 2 — the members' assets + the projects/users referenced by the (already
  // kit-scoped, ≤20) line items and scan logs, all read by id instead of org-wide.
  const memberAssetIds = serialized.map((si) => si.assetId).filter((x): x is string => !!x);
  const memberBulkIds = bulk.map((bi) => bi.bulkAssetId).filter((x): x is string => !!x);
  const scanUserIds = [...new Set(scanLogRows.map((l) => l.scannedById).filter((u): u is string => !!u))];
  const projectIds = [
    ...new Set(
      [...lineItemRows, ...scanLogRows]
        .map((r) => r.projectId)
        .filter((p): p is string => !!p),
    ),
  ];

  // listByIds caps at 1000 ids (it's user-callable). A kit could in theory have
  // more members than that, and the old getKit had no cap — so batch in chunks of
  // 1000 to preserve the no-cap behaviour for this trusted server caller.
  const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  const [memberAssets, memberBulkAssets, projects, scanUsers] = await Promise.all([
    Promise.all(
      chunk(memberAssetIds, 1000).map((ids) => convex.query(api.assets.listByIds, { orgId: organizationId, ids })),
    ).then((r) => r.flat()),
    Promise.all(
      chunk(memberBulkIds, 1000).map((ids) => convex.query(api.bulkAssets.listByIds, { orgId: organizationId, ids })),
    ).then((r) => r.flat()),
    projectIds.length
      ? convex.query(api.projects.listByIds, { orgId: organizationId, ids: projectIds })
      : Promise.resolve([]),
    scanUserIds.length
      ? prisma.user.findMany({ where: { id: { in: scanUserIds } } })
      : Promise.resolve([]),
  ]);

  const projMap = new Map(projects.map((p) => [p.id, p]));
  const userMap = new Map(scanUsers.map((u) => [u.id, u]));

  // Line items: attach project from the by-id map (drop any whose project is absent).
  const lineItems = lineItemRows.flatMap((r) => {
    const project = projMap.get(r.projectId);
    if (!project) return [];
    return [{ ...mapLineItemDoc(r), project }];
  });

  // Scan logs: same mapped shape as before; scannedBy (Better-Auth User, Prisma)
  // and project resolved from the by-id maps.
  const scanLogs = scanLogRows.map((l) => ({
    id: l.id,
    organizationId: l.organizationId,
    assetId: l.assetId ?? null,
    bulkAssetId: l.bulkAssetId ?? null,
    kitId: l.kitId ?? null,
    projectId: l.projectId ?? null,
    action: l.action,
    scannedById: l.scannedById,
    scannedAt: l.scannedAt != null ? new Date(l.scannedAt) : null,
    notes: l.notes ?? null,
    location: l.location ?? null,
    scannedBy: userMap.get(l.scannedById) ?? null,
    project: l.projectId ? projMap.get(l.projectId) ?? null : null,
  }));

  // Map the Convex member assets to the Prisma row shape the detail page expects.
  const assetMap = new Map(memberAssets.map((a) => [a.id, mapConvexAssetToPrisma(a)]));
  const bulkAssetMap = new Map(memberBulkAssets.map((b) => [b.id, mapConvexBulkAssetToPrisma(b)]));


  // Location + Category FKs were dropped (Phase B); attach both from the Convex mirror.
  const location = kit.locationId
    ? (await getLocationMap(organizationId)).get(kit.locationId) ?? null
    : null;
  const category = kit.categoryId
    ? (await getCategoryMap(organizationId)).get(kit.categoryId) ?? null
    : null;

  // A member whose asset is absent from the mirror is anomalous (the Prisma FK
  // join always returned the asset) — drop it rather than surface a null asset.
  const serializedItems = serialized
    .flatMap((si) => {
      const asset = assetMap.get(si.assetId);
      if (!asset) return [];
      return [{
        ...si,
        asset: { ...asset, model: asset.modelId ? modelMap.get(asset.modelId) ?? null : null },
      }];
    });

  const bulkItems = bulk
    .flatMap((bi) => {
      const bulkAsset = bulkAssetMap.get(bi.bulkAssetId);
      if (!bulkAsset) return [];
      return [{
        ...bi,
        bulkAsset: { ...bulkAsset, model: bulkAsset.modelId ? modelMap.get(bulkAsset.modelId) ?? null : null },
      }];
    });

  // Coerce the Convex-optional kit fields to the Prisma defaults / shape the page
  // expects (status/condition default, ms timestamps → Date).
  const kitRow = {
    ...kit,
    status: kit.status ?? "AVAILABLE",
    condition: kit.condition ?? "NEW",
    isActive: kit.isActive ?? true,
    purchaseDate: kit.purchaseDate != null ? new Date(kit.purchaseDate) : null,
    createdAt: kit.createdAt != null ? new Date(kit.createdAt) : new Date(0),
    updatedAt: kit.updatedAt != null ? new Date(kit.updatedAt) : new Date(0),
  };

  return serialize({
    ...kitRow,
    location,
    category,
    serializedItems,
    bulkItems,
    lineItems,
    scanLogs,
    maintenanceRecords,
    media: withResolvedFile(media),
  });
}

export async function createKit(data: KitFormValues) {
  const { organizationId, userId, userName } = await requirePermission("kit", "create");
  const parsed = kitSchema.parse(data);

  // Dup-guard the assetTag against the Convex mirror (the Prisma unique
  // constraint is gone now that kits are Convex-only).
  const existingTag = await getKitByAssetTag(organizationId, parsed.assetTag);
  if (existingTag) {
    throw new Error(`Asset tag "${parsed.assetTag}" already exists`);
  }

  const id = createId();
  const now = Date.now();
  const convex = await getConvexClient();
  await convex.mutation(api.kits.create, {
    id,
    organizationId,
    name: parsed.name,
    assetTag: parsed.assetTag,
    description: parsed.description || undefined,
    categoryId: parsed.categoryId || undefined,
    status: parsed.status,
    condition: parsed.condition,
    locationId: parsed.locationId || undefined,
    weight: parsed.weight ?? undefined,
    caseType: parsed.caseType || undefined,
    caseDimensions: parsed.caseDimensions || undefined,
    notes: parsed.notes || undefined,
    purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate).getTime() : undefined,
    purchasePrice: parsed.purchasePrice ?? undefined,
    image: parsed.image || undefined,
    images: parsed.images ?? undefined,
    barcode: parsed.assetTag,
    qrCode: parsed.assetTag,
    isActive: parsed.isActive,
    tags: parsed.tags ?? undefined,
    checkMode: parsed.checkMode,
    createdAt: now,
    updatedAt: now,
  });
  await reserveAssetTags(1);

  const created = await getKitById(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "kit",
    entityId: id,
    entityName: parsed.assetTag,
    summary: `Created kit ${parsed.assetTag} - ${parsed.name}`,
    details: { created: { assetTag: parsed.assetTag, name: parsed.name } },
    kitId: id,
  });

  // Always surface `id` (read-back can lag the mirror); callers route on it.
  return serialize({ ...created, id });
}

export async function updateKit(id: string, data: KitFormValues) {
  const { organizationId, userId, userName } = await requirePermission("kit", "update");
  const parsed = kitSchema.parse(data);

  const existing = await getKitById(id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Kit not found");
  }

  // Dup-guard the assetTag if it changed (Prisma unique constraint is gone).
  if (parsed.assetTag !== existing.assetTag) {
    const tagOwner = await getKitByAssetTag(organizationId, parsed.assetTag);
    if (tagOwner && tagOwner.id !== id) {
      throw new Error(`Asset tag "${parsed.assetTag}" already exists`);
    }
  }

  const now = Date.now();
  const convex = await getConvexClient();
  await convex.mutation(api.kits.update, {
    id,
    patch: {
      name: parsed.name,
      assetTag: parsed.assetTag,
      description: parsed.description || undefined,
      categoryId: parsed.categoryId || undefined,
      status: parsed.status,
      condition: parsed.condition,
      locationId: parsed.locationId || undefined,
      weight: parsed.weight ?? undefined,
      caseType: parsed.caseType || undefined,
      caseDimensions: parsed.caseDimensions || undefined,
      notes: parsed.notes || undefined,
      purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate).getTime() : undefined,
      purchasePrice: parsed.purchasePrice ?? undefined,
      image: parsed.image || undefined,
      images: parsed.images ?? undefined,
      isActive: parsed.isActive,
      tags: parsed.tags ?? undefined,
      checkMode: parsed.checkMode,
      updatedAt: now,
    },
  });

  const updated = await getKitById(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: id,
    entityName: parsed.assetTag,
    summary: `Updated kit ${parsed.assetTag} - ${parsed.name}`,
    kitId: id,
  });

  // Always surface `id` (read-back can lag the mirror); callers route on it.
  return serialize({ ...updated, id });
}

export async function updateKitNotes(id: string, notes: string) {
  const { organizationId } = await requirePermission("kit", "update");
  const existing = await getKitById(id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Kit not found");
  }
  const convex = await getConvexClient();
  await convex.mutation(api.kits.update, {
    id,
    // notes: undefined clears the field (Convex patch deletes undefined keys).
    patch: { notes: notes || undefined, updatedAt: Date.now() },
  });
  const updated = await getKitById(id);
  return serialize(updated);
}

// ---------------------------------------------------------------------------
// archiveKit – soft delete: remove all contents, then deactivate
// ---------------------------------------------------------------------------
export async function archiveKit(id: string) {
  const { organizationId, userId, userName } = await requirePermission("kit", "delete");

  const kit = await getKitById(id);
  if (!kit || kit.organizationId !== organizationId) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Only AVAILABLE kits can be archived");
  }

  // Atomic Convex cascade: releases members + assets + restores bulk quantities,
  // then soft-deletes the kit (isActive=false, status=RETIRED). The status
  // re-guard lives inside the mutation.
  const convex = await getConvexClient();
  await convex.mutation(api.kits.archiveCascade, {
    organizationId,
    kitId: id,
    now: Date.now(),
  });

  const archived = await getKitById(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "kit",
    entityId: id,
    entityName: kit.assetTag,
    summary: `Archived kit ${kit.assetTag} - ${kit.name}`,
    kitId: id,
  });

  return serialize(archived);
}

// ---------------------------------------------------------------------------
// canDeleteKit – predicate for UI to decide which delete options are available
// ---------------------------------------------------------------------------
export async function canDeleteKit(id: string) {
  const { organizationId } = await requirePermission("kit", "delete");

  // The kit row comes off Convex (the dual-written reactive mirror); a miss
  // reads null with no Prisma fallback (a fallback would mask mirror drift).
  const convexKit = await getKitById(id);
  if (!convexKit || convexKit.organizationId !== organizationId) {
    throw new Error("Kit not found");
  }

  // ProjectLineItem references stay on Prisma until the keystone
  // project-line-item tree migrates (see FEATUREDOCS/54).
  const referencingLineItems = (await (await getConvexClient()).query(api.projectLineItems.listByKitId, { kitId: id, orgId: organizationId })).length;

  return serialize(
    computeKitDeletability(coerceKitDeletabilityRow(convexKit), referencingLineItems),
  );
}

// ---------------------------------------------------------------------------
// deleteKit – hard delete. Releases contents then removes the kit row entirely.
// Blocked if the kit is referenced by any ProjectLineItem, regardless of status,
// to preserve historical project data. Use archiveKit for the reversible path.
// ---------------------------------------------------------------------------
export async function deleteKit(id: string) {
  const { organizationId, userId, userName } = await requirePermission("kit", "delete");

  const kit = await getKitById(id);
  if (!kit || kit.organizationId !== organizationId) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") {
    throw new Error("Only AVAILABLE kits can be deleted");
  }

  // ProjectLineItem references stay on Prisma until the keystone
  // project-line-item tree migrates (see FEATUREDOCS/54).
  const referencingLineItems = (await (await getConvexClient()).query(api.projectLineItems.listByKitId, { kitId: id, orgId: organizationId })).length;
  if (referencingLineItems > 0) {
    throw new Error(
      `This kit is referenced by ${referencingLineItems} project line item${
        referencingLineItems === 1 ? "" : "s"
      }. Archive it instead, or remove it from those projects first.`,
    );
  }

  const tagForLog = kit.assetTag;
  const nameForLog = kit.name;

  const convexKits = await getConvexClient();

  // Capture kit_check_item ids before the cascade delete (Convex has no FK cascade).
  const kitCheckItemRows = await convexKits.query(api.kitCheckItems.listByKitId, { orgId: organizationId, kitId: id });

  // Atomic Convex cascade: releases serialized assets + restores bulk
  // quantities, deletes member rows, then hard-deletes the kit row. The status
  // re-guard lives inside the mutation.
  await convexKits.mutation(api.kits.deleteCascade, {
    organizationId,
    kitId: id,
    now: Date.now(),
  });

  // Clean up kit-scoped metadata that the cascade doesn't cover. kitCheckItem
  // rows are removed via their dedicated mutation; kitMedia rows (Convex-only,
  // Phase C) are removed directly below.
  for (const row of kitCheckItemRows) await convexKits.mutation(api.kitCheckItems.remove, { id: row.id });
  // kitMedia is Convex-only (Phase C); remove the kit's media rows directly (the
  // old syncMediaForParent reconcile is gone with the mirror). Files are left on
  // S3, as the prior cascade did.
  const kitMediaRows = await getKitMediaFromConvex(id);
  for (const m of kitMediaRows) await convexKits.mutation(api.kitMedia.remove, { id: m.id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "kit",
    entityId: id,
    entityName: tagForLog,
    summary: `Permanently deleted kit ${tagForLog} - ${nameForLog}`,
  });

  return serialize({ id, hardDeleted: true });
}

export async function addSerializedItemToKit(
  kitId: string,
  data: KitSerializedItemFormValues,
) {
  const { organizationId, userId } = await requirePermission("kit", "update");
  const parsed = kitSerializedItemSchema.parse(data);

  // The Convex mutation does the kit-AVAILABLE + asset-availability guards
  // (AVAILABLE / unkitted / not-an-accessory) and sets the asset's kitId +
  // location atomically — no duplicate Prisma guard reads/writes here.
  const convex = await getConvexClient();
  const { id: memberId } = await convex.mutation(api.kits.addSerializedItem, {
    organizationId,
    kitId,
    assetId: parsed.assetId,
    position: parsed.position || undefined,
    notes: parsed.notes || undefined,
    addedById: userId,
    now: Date.now(),
  });

  // Read back the created member's asset (+ model) for the return shape. Callers
  // only refetch on success, but keep the faithful shape.
  const asset = await getAssetById(parsed.assetId);
  const assetModel = asset?.modelId ? await getModelById(asset.modelId) : null;
  return serialize({
    id: memberId,
    organizationId,
    kitId,
    assetId: parsed.assetId,
    position: parsed.position ?? null,
    notes: parsed.notes ?? null,
    addedById: userId,
    asset: asset ? { ...asset, model: assetModel } : null,
  });
}

// Batch add multiple serialized assets.
export async function addSerializedItemsToKit(
  kitId: string,
  items: Array<{ assetId: string; position?: string }>,
) {
  const { organizationId, userId } = await requirePermission("kit", "update");

  if (items.length === 0) throw new Error("No items to add");

  // The Convex mutation does the kit-AVAILABLE + per-asset availability guards
  // and the asset kitId/location coupling atomically (the loser of a race is
  // retried by OCC). It returns the created member ids in input order.
  const convex = await getConvexClient();
  const { ids } = await convex.mutation(api.kits.addSerializedItems, {
    organizationId,
    kitId,
    items: items.map((i) => ({ assetId: i.assetId, position: i.position || undefined })),
    addedById: userId,
    now: Date.now(),
  });

  // Read back assets (+ models) for the return shape. Callers only refetch on
  // success, but keep the faithful per-member shape.
  const modelMap = await getModelMap(organizationId);
  const created = await Promise.all(
    items.map(async (item, idx) => {
      const asset = await getAssetById(item.assetId);
      return {
        id: ids[idx],
        organizationId,
        kitId,
        assetId: item.assetId,
        position: item.position ?? null,
        addedById: userId,
        asset: asset
          ? { ...asset, model: asset.modelId ? modelMap.get(asset.modelId) ?? null : null }
          : null,
      };
    }),
  );
  return serialize(created);
}

export async function removeSerializedItemFromKit(
  kitId: string,
  assetId: string,
) {
  const { organizationId } = await requirePermission("kit", "update");

  // The Convex mutation does the kit-AVAILABLE guard, deletes the member row,
  // and releases the asset (kitId cleared, status AVAILABLE) atomically.
  const convex = await getConvexClient();
  await convex.mutation(api.kits.removeSerializedItem, {
    organizationId,
    kitId,
    assetId,
    now: Date.now(),
  });

  return serialize({ success: true });
}

export async function addBulkItemToKit(
  kitId: string,
  data: KitBulkItemFormValues,
) {
  const { organizationId, userId } = await requirePermission("kit", "update");
  const parsed = kitBulkItemSchema.parse(data);

  // The Convex mutation does the kit-AVAILABLE guard, inserts the member row,
  // and the guarded availableQuantity decrement (throws + rolls back if
  // insufficient) atomically.
  const convex = await getConvexClient();
  const { id: memberId } = await convex.mutation(api.kits.addBulkItem, {
    organizationId,
    kitId,
    bulkAssetId: parsed.bulkAssetId,
    quantity: parsed.quantity,
    position: parsed.position || undefined,
    notes: parsed.notes || undefined,
    addedById: userId,
    now: Date.now(),
  });

  // Read back the bulk asset (+ model) for the return shape.
  const bulkAsset = await getBulkAssetById(parsed.bulkAssetId);
  const bulkAssetModel = bulkAsset?.modelId ? await getModelById(bulkAsset.modelId) : null;
  return serialize({
    id: memberId,
    organizationId,
    kitId,
    bulkAssetId: parsed.bulkAssetId,
    quantity: parsed.quantity,
    position: parsed.position ?? null,
    notes: parsed.notes ?? null,
    addedById: userId,
    bulkAsset: bulkAsset ? { ...bulkAsset, model: bulkAssetModel } : null,
  });
}

export async function removeBulkItemFromKit(
  kitId: string,
  bulkItemId: string,
) {
  const { organizationId } = await requirePermission("kit", "update");

  // The Convex mutation does the kit-AVAILABLE guard + ownership check, deletes
  // the member row, and restores the bulk asset's availableQuantity atomically.
  const convex = await getConvexClient();
  await convex.mutation(api.kits.removeBulkItem, {
    organizationId,
    kitId,
    bulkItemId,
    now: Date.now(),
  });

  return serialize({ success: true });
}

// Serialized assets not in any kit. Reads off the dual-written Convex `assets`
// list; the eligibility where + assetTag sort are replicated by the pure
// filterAvailableAssetsForKit / sortByAssetTagAsc helpers (Phase A).
export async function getAvailableAssetsForKit(modelId?: string) {
  const { organizationId } = await getOrgContext();

  const [allAssets, modelMap] = await Promise.all([
    getAssetsByOrg(organizationId),
    getModelMap(organizationId),
  ]);
  const assets = sortByAssetTagAsc(filterAvailableAssetsForKit(allAssets, modelId));
  return serialize(assets.map((a) => ({
    ...a,
    model: a.modelId ? modelMap.get(a.modelId) ?? null : null,
  })));
}

// Bulk assets with available quantity. Reads off the dual-written Convex
// `bulkAssets` list; eligibility + sort via the pure helpers (Phase A).
export async function getAvailableBulkAssetsForKit() {
  const { organizationId } = await getOrgContext();

  const [allBulkAssets, modelMap] = await Promise.all([
    getBulkAssetsByOrg(organizationId),
    getModelMap(organizationId),
  ]);
  const bulkAssets = sortByAssetTagAsc(filterAvailableBulkAssetsForKit(allBulkAssets));
  return serialize(bulkAssets.map((b) => ({
    ...b,
    model: b.modelId ? modelMap.get(b.modelId) ?? null : null,
  })));
}


