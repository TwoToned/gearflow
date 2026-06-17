import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { getAssetsByOrg, getBulkAssetsByOrg } from "@/lib/assets-read";
import { getKitsByOrg } from "@/lib/kits-read";
import { getProjectsByOrg } from "@/lib/projects-read";

/**
 * Server-side read helpers for the Locations domain (Phase 3 cutover).
 *
 * Locations are dual-written like Suppliers: every create/update/delete writes
 * BOTH the Prisma `location` row (the durable FK anchor — `asset`, `bulk_asset`,
 * `kit`, `project`, `warehouse_dashboard_token` carry a nullable FK, and
 * `location_media` carries a **required + Cascade** FK; plus the
 * self-referential `parentId`) AND the Convex `locations` doc (the reactive read
 * source the browser subscribes to). Reads that want reactivity — the location
 * list, the location dropdowns, the edit form — go through Convex via this helper
 * / the `use-locations` hooks. Cross-domain joins and the parent/children
 * hierarchy composition stay on the (dual-write-fresh) Prisma mirror for now and
 * migrate at Prisma-decommission. See FEATUREDOCS/54.
 *
 * The Convex location doc carries the same business fields as the Prisma row
 * (name, address, lat/long, type, isDefault, parentId, notes, tags) plus the
 * preserved cuid `id` and numeric `createdAt`/`updatedAt`.
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
// Replaces the pure Prisma list read in server/locations.ts (`getLocations`).
// Locations are dual-written, so the Convex list is the read source. The
// self-referential parent (name only) and the per-location relation counts
// (assets, bulkAssets, kits, projects from their dual-written Convex lists;
// children from this list) are computed CLIENT-side in JS; filter/sort/paginate
// replicate the Prisma `where`/`orderBy`/`skip`/`take` exactly.
//
// MAPPING: `serialize()` keeps Date intact, so the old action returned Dates —
// we convert epoch-ms → Date. Prisma-defaulted columns (type=WAREHOUSE,
// isDefault=false, tags=[]) are coerced non-null. cuid `id` preserved; `_id`/
// `_creationTime` stripped. The `_count.projects` is faithful to the original:
// it counts ALL projects on the location (templates included — the original had
// no isTemplate filter).
// ---------------------------------------------------------------------------

/** A location mapped from its flat Convex doc to the Prisma-row business shape. */
export interface MappedLocation {
  id: string;
  organizationId: string;
  name: string;
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
}

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
