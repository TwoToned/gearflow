"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getClientMap } from "@/lib/clients-read";
import { locationSchema, type LocationFormValues } from "@/lib/validations/asset";
import type { Prisma } from "@/generated/prisma/client";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { buildFilterWhere, type FilterValue, type FilterColumnDef } from "@/lib/table-utils";

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

  // If this is set as default, unset other defaults
  if (parsed.isDefault) {
    await prisma.location.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const result = await prisma.location.create({
    data: {
      ...parsed,
      parentId: parsed.parentId || null,
      organizationId,
    },
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

  if (parsed.isDefault) {
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
  return serialize(await prisma.location.update({
    where: { id, organizationId },
    data: { notes: notes || null },
  }));
}
