"use server";

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { locationSchema, type LocationFormValues } from "@/lib/validations/asset";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { type FilterValue } from "@/lib/table-utils";
import {
  listLocations,
  getLocationDetail,
  getLocationById,
  getLocationsByOrg,
  getLocationMediaGallery,
  countLocationRelations,
  type ConvexLocation,
} from "@/lib/locations-read";

// Locations are CONVEX-ONLY (Phase B write inversion): every create/update/delete
// writes the Convex `locations` doc as the sole source of truth — no Prisma row,
// no mirror. The inbound Prisma FKs into `location` (asset.locationId,
// bulk_asset.locationId, kit.locationId, project.locationId, the self-ref
// location.parentId, location_media.locationId [was Cascade], and
// warehouse_dashboard_token.locationId [was SetNull]) were dropped (migration
// 20260617131000_drop_location_fk_constraints), so each is now a plain string
// holding the Convex cuid.
//
// Invariants re-implemented in app code (Convex has no constraints/cascades):
//  - Single-default-per-org: createLocation / updateLocation toggle isDefault; the
//    Convex-only `unsetDefaultsInConvex` clears every other org default first.
//  - Delete guards: re-implemented from Convex counts — "Cannot delete location
//    with sub-locations" if children > 0; "Cannot delete location with assets
//    assigned to it" if assets/bulkAssets > 0 (matches the old `_count` guard).
//  - location_media Cascade: the dropped Cascade FK auto-deleted a location's
//    media on delete. Re-implemented in deleteLocation — after the guards pass,
//    every locationMedia doc for the location is removed from Convex.
//  - Org-guard: reads the target via getLocationById and verifies organizationId
//    before any update/remove (matches the old where:{id,organizationId}).
//
// Reads (list, detail, counts) already source from Convex via locations-read.
// See FEATUREDOCS/54 + docs/designs/convex-decommission-RUNBOOK.md.

/**
 * Clear `isDefault` in Convex for every other current default in the org
 * (Convex-only re-implementation of the old Prisma
 * `updateMany({ where: { organizationId, isDefault: true, NOT: { id } }, data: { isDefault: false } })`).
 * Reads the org's locations from Convex and patches each default except `exceptId`.
 */
async function unsetDefaultsInConvex(organizationId: string, exceptId?: string) {
  const locations = await getLocationsByOrg(organizationId);
  const convex = await getConvexClient();
  for (const l of locations) {
    if (l.isDefault && l.id !== exceptId) {
      await convex.mutation(api.locations.update, {
        id: l.id,
        patch: { isDefault: false, updatedAt: Date.now() },
      });
    }
  }
}

// Locations list — READ FROM CONVEX. Filter/sort/paginate + the parent name
// self-join + per-location relation counts are all computed client-side from the
// Convex location/asset/bulk-asset/kit/project lists. The enum `filters.type` is
// pulled out as a plain string[] for the JS filter. See src/lib/locations-read.ts.
export async function getLocations(params?: {
  search?: string;
  type?: string;
  filters?: Record<string, FilterValue>;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();
  const {
    search,
    type,
    filters,
    page = 1,
    pageSize = 25,
    sortBy = "name",
    sortOrder = "asc",
  } = params || {};

  const rawTypeFilter = filters?.type;
  const typeIn = Array.isArray(rawTypeFilter) ? (rawTypeFilter as string[]) : undefined;

  return serialize(
    await listLocations(organizationId, {
      search,
      type,
      typeIn,
      page,
      pageSize,
      sortBy,
      sortOrder,
    }),
  );
}

// Detail-page composite — READ FROM CONVEX (Phase B). The deep Prisma include
// (parent/children/assets/bulkAssets/kits/projects/media + _count) is rebuilt
// from the Convex domain lists in getLocationDetail (locations-read.ts), since
// every inbound Location FK relation was dropped.
export async function getLocation(id: string) {
  const { organizationId } = await getOrgContext();
  const detail = await getLocationDetail(id, organizationId);
  if (!detail) return null;
  return serialize(detail);
}

/** Map a Convex location doc to the serialized Prisma-row shape consumers expect. */
function toLocationRowShape(doc: {
  id: string;
  organizationId: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  type?: string;
  isDefault?: boolean;
  parentId?: string | null;
  notes?: string | null;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}) {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    name: doc.name,
    address: doc.address ?? null,
    latitude: doc.latitude ?? null,
    longitude: doc.longitude ?? null,
    type: doc.type ?? "WAREHOUSE",
    isDefault: doc.isDefault ?? false,
    parentId: doc.parentId ?? null,
    notes: doc.notes ?? null,
    tags: doc.tags ?? [],
    createdAt: new Date(doc.createdAt ?? Date.now()),
    updatedAt: new Date(doc.updatedAt ?? Date.now()),
  };
}

export async function createLocation(data: LocationFormValues) {
  const { organizationId, userId, userName } = await requirePermission("location", "create");
  const parsed = locationSchema.parse(data);

  // Single-default-per-org: clear other defaults before setting this one.
  if (parsed.isDefault) {
    await unsetDefaultsInConvex(organizationId);
  }

  // Explicit cuid so external references hold the same id Convex stores.
  const id = createId();
  const now = Date.now();
  await (await getConvexClient()).mutation(api.locations.create, {
    id,
    organizationId,
    name: parsed.name,
    address: parsed.address || undefined,
    latitude: parsed.latitude ?? undefined,
    longitude: parsed.longitude ?? undefined,
    type: parsed.type,
    isDefault: parsed.isDefault ?? false,
    parentId: parsed.parentId || undefined,
    notes: parsed.notes || undefined,
    tags: parsed.tags ?? [],
    createdAt: now,
    updatedAt: now,
  });

  const result = toLocationRowShape({
    id,
    organizationId,
    name: parsed.name,
    address: parsed.address,
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    type: parsed.type,
    isDefault: parsed.isDefault ?? false,
    parentId: parsed.parentId || null,
    notes: parsed.notes,
    tags: parsed.tags,
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "location",
    entityId: result.id,
    entityName: result.name,
    summary: `Created location ${result.name}`,
  });

  return serialize(result);
}

export async function updateLocation(id: string, data: LocationFormValues) {
  const { organizationId, userId, userName } = await requirePermission("location", "update");
  const parsed = locationSchema.parse(data);

  const existing = await getLocationById(id);
  if (!existing || existing.organizationId !== organizationId) throw new Error("Location not found");

  if (parsed.isDefault) {
    await unsetDefaultsInConvex(organizationId, id);
  }

  // Convex `db.patch` treats `undefined` as field removal, matching the old
  // Prisma `address || null` / `parentId || null` clears.
  await (await getConvexClient()).mutation(api.locations.update, {
    id,
    patch: {
      name: parsed.name,
      address: parsed.address || undefined,
      latitude: parsed.latitude ?? undefined,
      longitude: parsed.longitude ?? undefined,
      type: parsed.type,
      isDefault: parsed.isDefault ?? false,
      parentId: parsed.parentId || undefined,
      notes: parsed.notes || undefined,
      tags: parsed.tags ?? [],
      updatedAt: Date.now(),
    },
  });

  const updated = toLocationRowShape({
    id,
    organizationId,
    name: parsed.name,
    address: parsed.address,
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    type: parsed.type,
    isDefault: parsed.isDefault ?? false,
    parentId: parsed.parentId || null,
    notes: parsed.notes,
    tags: parsed.tags,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "location",
    entityId: updated.id,
    entityName: updated.name,
    summary: `Updated location ${updated.name}`,
  });

  return serialize(updated);
}

export async function deleteLocation(id: string) {
  const { organizationId, userId, userName } = await requirePermission("location", "delete");

  const location = await getLocationById(id);
  if (!location || location.organizationId !== organizationId) throw new Error("Location not found");

  // Delete guards re-implemented from Convex counts (replaces the old Prisma
  // `_count: { assets, bulkAssets, children }`).
  const [allLocations, allAssets, allBulkAssets] = await Promise.all([
    getLocationsByOrg(organizationId),
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
  ]);
  const counts = countLocationRelations(id, allLocations, allAssets, allBulkAssets);
  if (counts.children > 0) throw new Error("Cannot delete location with sub-locations");
  if (counts.assets > 0 || counts.bulkAssets > 0) {
    throw new Error("Cannot delete location with assets assigned to it");
  }

  const convex = await getConvexClient();

  // location_media Cascade re-implementation: the dropped Cascade FK auto-deleted
  // a location's media rows on delete. location_media is Convex-only now — remove
  // every locationMedia row for this location from Convex, then delete the
  // location itself. (The old Cascade dropped only the join rows, leaving
  // file_upload rows; this preserves that exact behaviour.)
  const media = await getLocationMediaGallery(id);
  for (const m of media) {
    await convex.mutation(api.locationMedia.remove, { id: m.id });
  }

  await convex.mutation(api.locations.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "location",
    entityId: id,
    entityName: location.name,
    summary: `Deleted location ${location.name}`,
    details: { deleted: { name: location.name } },
  });

  return serialize({ id });
}

export async function updateLocationNotes(id: string, notes: string) {
  const { organizationId } = await requirePermission("location", "update");

  const existing = await getLocationById(id);
  if (!existing || existing.organizationId !== organizationId) throw new Error("Location not found");

  await (await getConvexClient()).mutation(api.locations.update, {
    id,
    patch: { notes: notes || undefined, updatedAt: Date.now() },
  });

  const updated: ConvexLocation = { ...existing, notes: notes || undefined, updatedAt: Date.now() };
  return serialize(toLocationRowShape(updated));
}
