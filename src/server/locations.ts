"use server";

import { type FunctionArgs } from "convex/server";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientMap } from "@/lib/clients-read";
import { locationSchema, type LocationFormValues } from "@/lib/validations/asset";
import type { Prisma } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";

// Locations are DUAL-WRITTEN: every create/update/delete writes the Prisma
// `location` row (the durable FK anchor — asset/bulk_asset/kit/project/
// warehouse_dashboard_token hold a nullable FK; location_media + stocktake hold
// a required + Cascade FK; plus the self-referential parentId) AND the Convex
// `locations` doc (the reactive read source). Prisma is written first; the Convex
// payload is derived from the written row via toConvexDoc so the two can't drift.
// The single-default invariant (only one isDefault per org) is enforced by a
// Prisma updateMany — that multi-row unset is mirrored to Convex too, else the
// reactive list would show two defaults. Server-side reads + the parent/children
// hierarchy stay on the always-fresh Prisma mirror. See FEATUREDOCS/54.

/** Mirror a freshly written Prisma location row into Convex (create). */
async function mirrorLocationToConvex(row: Record<string, unknown>) {
  await (await getConvexClient()).mutation(
    api.locations.createIfMissing,
    toConvexDoc(row) as FunctionArgs<typeof api.locations.createIfMissing>,
  );
}

/** Mirror an updated Prisma location row into Convex (patch, id stripped). */
async function patchLocationInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...patch } = toConvexDoc(row);
  await (await getConvexClient()).mutation(api.locations.update, {
    id,
    patch: patch as FunctionArgs<typeof api.locations.update>["patch"],
  });
}

/**
 * Clear `isDefault` in Convex for the given location ids (mirrors the Prisma
 * updateMany that enforces one default per org). Skips one id (the row about to
 * become/stay default) so we don't immediately re-clear it.
 */
async function unsetDefaultsInConvex(organizationId: string, exceptId?: string) {
  const prevDefaults = await prisma.location.findMany({
    where: { organizationId, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  const convex = (await getConvexClient());
  for (const d of prevDefaults) {
    await convex.mutation(api.locations.update, { id: d.id, patch: { isDefault: false } });
  }
}

const locationFilterColumns: FilterColumnDef[] = [
  { id: "type", filterType: "enum", filterKey: "type" },
];

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

  const filterWhere = buildFilterWhere(filters, locationFilterColumns);

  const where: Prisma.LocationWhereInput = {
    organizationId,
    ...(type && { type: type as Prisma.EnumLocationTypeFilter }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
      ],
    }),
    ...filterWhere,
  };

  const [locations, total] = await Promise.all([
    prisma.location.findMany({
      where,
      include: {
        parent: { select: { name: true } },
        _count: { select: { assets: true, bulkAssets: true, kits: true, children: true, projects: true } },
      },
      orderBy: sortBy === "parent" ? { parent: { name: sortOrder } }
        : [{ isDefault: "desc" }, { [sortBy]: sortOrder }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.location.count({ where }),
  ]);

  return serialize({
    locations,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

/**
 * Asset + bulk-asset + kit counts per location (locationId -> counts).
 * Cross-domain: assets / bulk assets / kits still live in Prisma, so this can't
 * come from Convex. Used by the reactive location table, which subscribes to the
 * location list via Convex and merges these (non-reactive) counts. (Children
 * counts are derived client-side from the reactive list itself.)
 */
export async function getLocationCounts(): Promise<Record<string, { assets: number; bulkAssets: number; kits: number }>> {
  const { organizationId } = await getOrgContext();
  const [assetGroups, bulkGroups, kitGroups] = await Promise.all([
    prisma.asset.groupBy({ by: ["locationId"], where: { organizationId, locationId: { not: null } }, _count: { _all: true } }),
    prisma.bulkAsset.groupBy({ by: ["locationId"], where: { organizationId, locationId: { not: null } }, _count: { _all: true } }),
    prisma.kit.groupBy({ by: ["locationId"], where: { organizationId, locationId: { not: null } }, _count: { _all: true } }),
  ]);
  const counts: Record<string, { assets: number; bulkAssets: number; kits: number }> = {};
  const ensure = (id: string) => (counts[id] ??= { assets: 0, bulkAssets: 0, kits: 0 });
  for (const g of assetGroups) if (g.locationId) ensure(g.locationId).assets = g._count._all;
  for (const g of bulkGroups) if (g.locationId) ensure(g.locationId).bulkAssets = g._count._all;
  for (const g of kitGroups) if (g.locationId) ensure(g.locationId).kits = g._count._all;
  return serialize(counts);
}

/** Inherit address/coordinates from parent when a child location has none of its own. */
function resolveLocationInheritance<T extends { address?: string | null; latitude?: number | null; longitude?: number | null; parent?: { address?: string | null; latitude?: number | null; longitude?: number | null } | null }>(location: T): T {
  if (location.parent) {
    if (!location.address) location.address = location.parent.address;
    if (location.latitude == null && location.longitude == null && location.parent.latitude != null) {
      location.latitude = location.parent.latitude;
      location.longitude = location.parent.longitude;
    }
  }
  return location;
}

export async function getLocation(id: string) {
  const { organizationId } = await getOrgContext();
  const location = await prisma.location.findUnique({
    where: { id, organizationId },
    include: {
      parent: true,
      children: {
        include: { _count: { select: { assets: true, bulkAssets: true } } },
        orderBy: { name: "asc" },
      },
      assets: {
        where: { isActive: true },
        include: { model: true },
        orderBy: { assetTag: "asc" },
        take: 50,
      },
      bulkAssets: {
        where: { isActive: true },
        include: { model: true },
        orderBy: { assetTag: "asc" },
        take: 50,
      },
      kits: {
        where: { isActive: true },
        orderBy: { assetTag: "asc" },
        take: 50,
      },
      projects: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      media: {
        include: { file: true },
        orderBy: { sortOrder: "asc" },
      },
      _count: { select: { assets: true, bulkAssets: true, kits: true, children: true, projects: true } },
    },
  });
  if (!location) return null;

  // Clients live in Convex — attach to each project instead of a Prisma join.
  const clientMap = await getClientMap(organizationId);
  const withClients = {
    ...location,
    projects: location.projects.map((p) => ({
      ...p,
      client: p.clientId ? clientMap.get(p.clientId) ?? null : null,
    })),
  };
  return serialize(withClients);
}

export async function createLocation(data: LocationFormValues) {
  const { organizationId, userId, userName } = await requirePermission("location", "create");
  const parsed = locationSchema.parse(data);

  // If this is set as default, unset other defaults (in Prisma AND Convex).
  if (parsed.isDefault) {
    await unsetDefaultsInConvex(organizationId);
    await prisma.location.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  // Explicit cuid so the Prisma row and the Convex doc share one id.
  const id = createId();
  const result = await prisma.location.create({
    data: {
      ...parsed,
      id,
      parentId: parsed.parentId || null,
      organizationId,
    },
  });
  await mirrorLocationToConvex(result);

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

  if (parsed.isDefault) {
    await unsetDefaultsInConvex(organizationId, id);
    await prisma.location.updateMany({
      where: { organizationId, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.location.update({
    where: { id, organizationId },
    data: {
      ...parsed,
      parentId: parsed.parentId || null,
    },
  });
  await patchLocationInConvex(id, updated);

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
  const location = await prisma.location.findUnique({
    where: { id, organizationId },
    include: { _count: { select: { assets: true, bulkAssets: true, children: true } } },
  });
  if (!location) throw new Error("Location not found");
  if (location._count.children > 0) throw new Error("Cannot delete location with sub-locations");
  if (location._count.assets > 0 || location._count.bulkAssets > 0) {
    throw new Error("Cannot delete location with assets assigned to it");
  }
  await prisma.location.delete({ where: { id, organizationId } });
  await (await getConvexClient()).mutation(api.locations.remove, { id });

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
  const updated = await prisma.location.update({
    where: { id, organizationId },
    data: { notes: notes || null },
  });
  await patchLocationInConvex(id, updated);
  return serialize(updated);
}
