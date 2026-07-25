import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { getKitsByOrg } from "@/lib/kits-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import { getModelMap } from "@/lib/models-read";
import { getClientMap } from "@/lib/clients-read";
import { mapGalleryFile, type GalleryFile } from "@/lib/media-read";

/**
 * Server-side read helpers for the Locations domain (Phase 3 cutover).
 *
 * Locations are Convex-only, like Suppliers: `prisma/schema.prisma` has no
 * `location` model, and there are no `prisma.location.*` writes anywhere in
 * `src/` — the Convex `locations` doc is the sole store, and every FK
 * relationship (`asset`, `bulk_asset`, `kit`, `project`,
 * `warehouse_dashboard_token`, `location_media`, plus the self-referential
 * `parentId`) resolves against the Convex `id`, not a Postgres row. All reads —
 * the location list, the location dropdowns, the edit form, cross-domain joins,
 * and the parent/children hierarchy composition — go through Convex via this
 * helper / the `use-locations` hooks. See FEATUREDOCS/54.
 *
 * The Convex location doc carries the same business fields the old Prisma row
 * used to (name, address, lat/long, type, isDefault, parentId, notes, tags) plus
 * the preserved cuid `id` and numeric `createdAt`/`updatedAt`.
 */
export type ConvexLocation = Doc<"locations">;

export async function getLocationById(id: string): Promise<ConvexLocation | null> {
  return await (await getConvexClient()).query(api.locations.getById, { id });
}

export async function getLocationsByOrg(orgId: string): Promise<ConvexLocation[]> {
  return await (await getConvexClient()).query(api.locations.list, { orgId });
}

/** The org's default location (isDefault: true), or null if none set. */
export async function getDefaultLocation(orgId: string): Promise<ConvexLocation | null> {
  const all = await getLocationsByOrg(orgId);
  return all.find((l) => l.isDefault) ?? null;
}

/** All of an org's locations keyed by cuid `id`, for attaching to joined rows. */
export async function getLocationMap(orgId: string): Promise<Map<string, ConvexLocation>> {
  const all = await getLocationsByOrg(orgId);
  return new Map(all.map((l) => [l.id, l]));
}

/**
 * Attach a `location` field to rows that carry a `locationId`, replacing a Prisma
 * `include: { location }`. One Convex round-trip per call (the org location map).
 */
export async function attachLocation<T extends { locationId: string | null }>(
  orgId: string,
  rows: T[],
): Promise<Array<T & { location: ConvexLocation | null }>> {
  if (rows.length === 0) return [];
  const map = await getLocationMap(orgId);
  return rows.map((r) => ({
    ...r,
    location: r.locationId ? map.get(r.locationId) ?? null : null,
  }));
}

// ---------------------------------------------------------------------------
// Primary reads — paginated/filtered/sorted list (Phase A)
//
// Replaces the pure Prisma list read server/locations.ts (`getLocations`) used to
// have. Locations are Convex-only, so the Convex list is the (only) read source. The
// self-referential parent (name only) and the per-location relation counts
// (assets, bulkAssets, kits, projects from their own Convex-only lists;
// children from this list) are computed CLIENT-side in JS; filter/sort/paginate
// replicate the old Prisma `where`/`orderBy`/`skip`/`take` exactly.
//
// MAPPING: `serialize()` keeps Date intact, so the old action returned Dates —
// we convert epoch-ms → Date. Prisma-defaulted columns (type=WAREHOUSE,
// isDefault=false, tags=[]) are coerced non-null. cuid `id` preserved; `_id`/
// `_creationTime` stripped. The `_count.projects` is faithful to the original:
// it counts ALL projects on the location (templates included — the original had
// no isTemplate filter).
// ---------------------------------------------------------------------------

/**
 * A location mapped from its flat Convex doc to the Prisma-row business shape.
 * Derived from `Doc<"locations">` (R-8.2.4) so schema drift is a compile error.
 */
export type MappedLocation = Omit<
  ConvexLocation,
  | "_id"
  | "_creationTime"
  | "address"
  | "latitude"
  | "longitude"
  | "type"
  | "isDefault"
  | "parentId"
  | "notes"
  | "tags"
  | "createdAt"
  | "updatedAt"
> & {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  type: string;
  isDefault: boolean;
  parentId: string | null;
  notes: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

/** Pure: Convex location doc → Prisma-row business shape (epoch-ms→Date, defaults coerced, `_id`/`_creationTime` stripped). */
export function mapLocation(doc: ConvexLocation): MappedLocation {
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
    createdAt: new Date(doc.createdAt ?? 0),
    updatedAt: new Date(doc.updatedAt ?? 0),
  };
}

/** Per-location relation counts (assets, bulkAssets, kits, children, projects). */
export interface LocationRelCounts {
  assets: number;
  bulkAssets: number;
  kits: number;
  children: number;
  projects: number;
}

/**
 * Pure: per-location relation counts from the flat domain lists. `children` is
 * derived from the location list's own parentId; the other four from their
 * respective lists' `locationId`.
 */
export function buildLocationCounts(
  locations: Array<{ id: string; parentId: string | null }>,
  assets: Array<{ locationId?: string | null }>,
  bulkAssets: Array<{ locationId?: string | null }>,
  kits: Array<{ locationId?: string | null }>,
  projects: Array<{ locationId?: string | null }>,
): Map<string, LocationRelCounts> {
  const counts = new Map<string, LocationRelCounts>();
  const ensure = (id: string) => {
    let e = counts.get(id);
    if (!e) counts.set(id, (e = { assets: 0, bulkAssets: 0, kits: 0, children: 0, projects: 0 }));
    return e;
  };
  for (const l of locations) if (l.parentId) ensure(l.parentId).children++;
  for (const a of assets) if (a.locationId) ensure(a.locationId).assets++;
  for (const b of bulkAssets) if (b.locationId) ensure(b.locationId).bulkAssets++;
  for (const k of kits) if (k.locationId) ensure(k.locationId).kits++;
  for (const p of projects) if (p.locationId) ensure(p.locationId).projects++;
  return counts;
}

/**
 * Pure: replicate the `getLocations` Prisma `where` filter — org scope is already
 * applied by the Convex query, so this covers `type` (exact), `search` (case-
 * insensitive substring on name OR address), and the `filters.type` enum (`in`).
 */
export function filterLocations<T extends { name: string; address: string | null; type: string }>(
  rows: T[],
  opts: { search?: string; type?: string; typeIn?: string[] },
): T[] {
  const search = opts.search?.toLowerCase();
  return rows.filter((r) => {
    if (opts.type && r.type !== opts.type) return false;
    if (opts.typeIn && opts.typeIn.length > 0 && !opts.typeIn.includes(r.type)) return false;
    if (search) {
      const inName = r.name.toLowerCase().includes(search);
      const inAddr = (r.address ?? "").toLowerCase().includes(search);
      if (!inName && !inAddr) return false;
    }
    return true;
  });
}

/**
 * Pure: replicate the `getLocations` Prisma `orderBy`. Two shapes:
 *  - sortBy === "parent" → order by the parent location's name (Postgres sorts
 *    NULLs LAST for ASC, FIRST for DESC — rows with no parent have a null key).
 *  - otherwise → `[{ isDefault: "desc" }, { [sortBy]: sortOrder }]` (default
 *    locations float to the top, then the chosen column).
 * Returns a NEW sorted array. `parentNameById` resolves a location's parent name.
 */
export function sortLocations<T extends MappedLocation>(
  rows: T[],
  sortBy: string,
  sortOrder: "asc" | "desc",
  parentNameById: Map<string, string | null>,
): T[] {
  const dir = sortOrder === "asc" ? 1 : -1;
  const cmpStr = (a: string | null | undefined, b: string | null | undefined) => {
    // Postgres NULLS LAST for ASC, NULLS FIRST for DESC.
    const an = a == null || a === "";
    const bn = b == null || b === "";
    if (an && bn) return 0;
    if (an) return sortOrder === "asc" ? 1 : -1;
    if (bn) return sortOrder === "asc" ? -1 : 1;
    return (a as string).localeCompare(b as string) * dir;
  };
  const out = [...rows];
  if (sortBy === "parent") {
    out.sort((a, b) => cmpStr(parentNameById.get(a.id) ?? null, parentNameById.get(b.id) ?? null));
    return out;
  }
  out.sort((a, b) => {
    // isDefault desc first (true before false).
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const av = (a as Record<string, unknown>)[sortBy];
    const bv = (b as Record<string, unknown>)[sortBy];
    if (typeof av === "string" || typeof bv === "string" || av == null || bv == null) {
      return cmpStr(av as string | null, bv as string | null);
    }
    if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * dir;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    if (typeof av === "boolean" && typeof bv === "boolean") return ((av ? 1 : 0) - (bv ? 1 : 0)) * dir;
    return 0;
  });
  return out;
}

/** A mapped location with `parent {name}` and `_count` — the `getLocations` row shape. */
export type LocationListRow = MappedLocation & {
  parent: { name: string } | null;
  _count: LocationRelCounts;
};

/** All of an org's locations mapped to the Prisma-row business shape. */
export async function getMappedLocationsByOrg(orgId: string): Promise<MappedLocation[]> {
  const docs = await getLocationsByOrg(orgId);
  return docs.map(mapLocation);
}

/**
 * `getLocations` from Convex: filter → sort → paginate, each row carrying
 * `parent {name}` and `_count {assets, bulkAssets, kits, children, projects}`.
 */
export async function listLocations(
  orgId: string,
  params: {
    search?: string;
    type?: string;
    typeIn?: string[];
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: "asc" | "desc";
  },
): Promise<{ locations: LocationListRow[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const [locations, assets, bulkAssets, kits, projects] = await Promise.all([
    getMappedLocationsByOrg(orgId),
    getAssetsByOrg(orgId),
    getBulkAssetsByOrg(orgId),
    getKitsByOrg(orgId),
    getProjectsByOrg(orgId),
  ]);

  const byId = new Map(locations.map((l) => [l.id, l]));
  const parentNameById = new Map<string, string | null>(
    locations.map((l) => [l.id, l.parentId ? byId.get(l.parentId)?.name ?? null : null]),
  );
  const counts = buildLocationCounts(locations, assets, bulkAssets, kits, projects);

  const filtered = filterLocations(locations, {
    search: params.search,
    type: params.type,
    typeIn: params.typeIn,
  });
  const total = filtered.length;
  const sorted = sortLocations(filtered, params.sortBy, params.sortOrder, parentNameById);
  const start = (params.page - 1) * params.pageSize;
  const pageRows = sorted.slice(start, start + params.pageSize);

  const rows: LocationListRow[] = pageRows.map((l) => {
    const parentRow = l.parentId ? byId.get(l.parentId) : undefined;
    return {
      ...l,
      parent: parentRow ? { name: parentRow.name } : null,
      _count: counts.get(l.id) ?? { assets: 0, bulkAssets: 0, kits: 0, children: 0, projects: 0 },
    };
  });

  return {
    locations: rows,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize),
  };
}

// ---------------------------------------------------------------------------
// Detail-page composite (Phase B) — `getLocation` reconstruction.
//
// The old `getLocation` was a single Prisma `findUnique` with a deep `include`
// (parent, children + their _count, assets/bulkAssets/kits/projects, media+file,
// and a top-level _count). Dropping the inbound Location FKs (Phase B) removed
// every one of those Prisma relations, so the composite is rebuilt here from the
// Convex-only domain lists. Shape is faithful to the prior serialized
// output the detail page consumes:
//   - parent  { id, name, address, latitude, longitude } | null
//   - children [{ id, name, _count: { assets, bulkAssets } }]  (name asc)
//   - assets/bulkAssets/kits  (isActive only, assetTag asc, take 50) w/ model {name}
//   - projects (createdAt desc, take 20) w/ client {name}
//   - media   [{ ...row, file }]  (sortOrder asc)
//   - _count  { assets, bulkAssets, kits, children, projects }
// Counts are over ALL rows; the per-tab arrays are the active/limited subsets,
// matching the original include's `where`/`take`.
// ---------------------------------------------------------------------------

type DetailAssetRow = { id: string; assetTag: string; status: string; model: { name: string } | null };
type DetailKitRow = { id: string; assetTag: string; name: string; status: string };
type DetailProjectRow = { id: string; projectNumber: string; name: string; status: string; client: { name: string } | null; createdAt: Date };
type DetailMediaRow = {
  id: string;
  organizationId: string;
  fileId: string;
  type: string;
  displayName: string | null;
  sortOrder: number;
  createdAt: Date;
  file: GalleryFile | null;
};

export interface LocationDetail extends MappedLocation {
  parent: { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null } | null;
  children: Array<{ id: string; name: string; _count: { assets: number; bulkAssets: number } }>;
  assets: DetailAssetRow[];
  bulkAssets: DetailAssetRow[];
  kits: DetailKitRow[];
  projects: DetailProjectRow[];
  media: DetailMediaRow[];
  _count: LocationRelCounts;
}

/**
 * `getLocation` detail composite from Convex. Returns null when the location
 * doesn't exist or belongs to another org (matches the old org-scoped
 * findUnique). One pass over the org's location/asset/bulk-asset/kit/project
 * lists, plus the location's own media gallery (locationMedia mirror + file
 * lookups).
 */
export async function getLocationDetail(
  id: string,
  organizationId: string,
): Promise<LocationDetail | null> {
  const [locDocs, allAssets, allBulk, allKits, allProjects, modelMap, clientMap] = await Promise.all([
    getLocationsByOrg(organizationId),
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
    getKitsByOrg(organizationId),
    getProjectsByOrg(organizationId),
    getModelMap(organizationId),
    getClientMap(organizationId),
  ]);

  const locations = locDocs.map(mapLocation);
  const self = locations.find((l) => l.id === id);
  if (!self) return null;

  const byId = new Map(locations.map((l) => [l.id, l]));

  // Counts over ALL rows for this location.
  const assetsHere = allAssets.filter((a) => a.locationId === id);
  const bulkHere = allBulk.filter((b) => b.locationId === id);
  const kitsHere = allKits.filter((k) => k.locationId === id);
  const projectsHere = allProjects.filter((p) => p.locationId === id);
  const childrenAll = locations.filter((l) => l.parentId === id);

  const _count: LocationRelCounts = {
    assets: assetsHere.length,
    bulkAssets: bulkHere.length,
    kits: kitsHere.length,
    children: childrenAll.length,
    projects: projectsHere.length,
  };

  // Parent.
  const parentRow = self.parentId ? byId.get(self.parentId) : undefined;
  const parent = parentRow
    ? {
        id: parentRow.id,
        name: parentRow.name,
        address: parentRow.address,
        latitude: parentRow.latitude,
        longitude: parentRow.longitude,
      }
    : null;

  // Children (name asc) + their asset/bulk counts.
  const children = [...childrenAll]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      _count: {
        assets: allAssets.filter((a) => a.locationId === c.id).length,
        bulkAssets: allBulk.filter((b) => b.locationId === c.id).length,
      },
    }));

  // Active asset/bulk/kit subsets — assetTag asc, take 50.
  const byTag = (a: { assetTag: string }, b: { assetTag: string }) =>
    a.assetTag < b.assetTag ? -1 : a.assetTag > b.assetTag ? 1 : 0;
  const assets: DetailAssetRow[] = assetsHere
    .filter((a) => a.isActive !== false)
    .sort(byTag)
    .slice(0, 50)
    .map((a) => ({
      id: a.id,
      assetTag: a.assetTag,
      status: (a.status ?? "AVAILABLE") as string,
      model: a.modelId ? { name: modelMap.get(a.modelId)?.name ?? "" } : null,
    }));
  const bulkAssets: DetailAssetRow[] = bulkHere
    .filter((b) => b.isActive !== false)
    .sort(byTag)
    .slice(0, 50)
    .map((b) => ({
      id: b.id,
      assetTag: b.assetTag,
      status: (b.status ?? "ACTIVE") as string,
      model: b.modelId ? { name: modelMap.get(b.modelId)?.name ?? "" } : null,
    }));
  const kits: DetailKitRow[] = kitsHere
    .filter((k) => k.isActive !== false)
    .sort(byTag)
    .slice(0, 50)
    .map((k) => ({
      id: k.id,
      assetTag: k.assetTag,
      name: k.name,
      status: (k.status ?? "AVAILABLE") as string,
    }));

  // Projects — createdAt desc, take 20 (original had no isTemplate filter).
  const projects: DetailProjectRow[] = [...projectsHere]
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 20)
    .map((p) => ({
      id: p.id,
      projectNumber: p.projectNumber,
      name: p.name,
      status: (p.status ?? "DRAFT") as string,
      client: p.clientId ? { name: clientMap.get(p.clientId)?.name ?? "" } : null,
      createdAt: new Date(p.createdAt ?? 0),
    }));

  // Media gallery — locationMedia mirror (sortOrder asc) + file lookups.
  const media = await getLocationMediaGallery(id);

  return { ...self, parent, children, assets, bulkAssets, kits, projects, media, _count };
}

/**
 * A location's media gallery from the Convex `locationMedia` mirror, ordered by
 * sortOrder asc, each row carrying its resolved `file` (replaces the old
 * `include: { media: { include: { file } }, orderBy: { sortOrder: "asc" } }`).
 */
export async function getLocationMediaGallery(locationId: string): Promise<DetailMediaRow[]> {
  const convex = await getConvexClient();
  const rows = (await convex.query(api.locationMedia.listByParent, { parentId: locationId })) as Doc<"locationMedia">[];
  const sorted = [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const fileIds = [...new Set(sorted.map((r) => r.fileId))];
  const fileDocs = await Promise.all(fileIds.map((fid) => convex.query(api.fileUploads.getById, { id: fid })));
  const fileMap = new Map<string, GalleryFile>();
  fileIds.forEach((fid, i) => {
    const mapped = mapGalleryFile(fileDocs[i]);
    if (mapped) fileMap.set(fid, mapped);
  });
  return sorted.map((m) => ({
    id: m.id,
    organizationId: m.organizationId,
    fileId: m.fileId,
    type: (m.type ?? "DOCUMENT") as string,
    displayName: m.displayName ?? null,
    sortOrder: m.sortOrder ?? 0,
    createdAt: new Date(m.createdAt ?? 0),
    file: fileMap.get(m.fileId) ?? null,
  }));
}

/**
 * Pure: per-location relation counts for a single location id, from the org
 * domain lists. Used by deleteLocation's guard (children / assets / bulkAssets).
 */
export function countLocationRelations(
  id: string,
  locations: Array<{ id: string; parentId?: string | null }>,
  assets: Array<{ locationId?: string | null }>,
  bulkAssets: Array<{ locationId?: string | null }>,
): { children: number; assets: number; bulkAssets: number } {
  return {
    children: locations.filter((l) => l.parentId === id).length,
    assets: assets.filter((a) => a.locationId === id).length,
    bulkAssets: bulkAssets.filter((b) => b.locationId === id).length,
  };
}
