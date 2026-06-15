import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Locations domain (Phase 3 cutover).
 *
 * Locations are dual-written like Suppliers: every create/update/delete writes
 * BOTH the Prisma `location` row (the durable FK anchor — `asset`, `bulk_asset`,
 * `kit`, `project`, `warehouse_dashboard_token` carry a nullable FK, and
 * `location_media` + `stocktake` carry a **required + Cascade** FK; plus the
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
