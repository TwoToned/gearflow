import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the `warehouseDashboardToken` domain (Phase B
 * write inversion, bucket-2). The table is CONVEX-ONLY now: every create/update/
 * delete writes the Convex `warehouseDashboardTokens` doc as the sole source of
 * truth (no Prisma row, no mirror). It has NO inbound Prisma FK, so no FK-drop
 * migration is needed — the Prisma `warehouse_dashboard_token` table is simply
 * left unwritten until Phase C drops it.
 *
 * These helpers read the Convex copy and shape it back into the Prisma-row form
 * the warehouse-display server actions return (epoch-ms → Date, absent optionals
 * → null, Prisma-defaulted columns coerced non-null). The cross-domain joins the
 * actions need (`createdBy` Auth User, `location` Convex doc) are attached in the
 * server action, exactly as before.
 *
 * SECURITY: `validateDisplayToken` (the public warehouse-display endpoint) hashes
 * the raw token and looks it up by `tokenHash` (the old `@unique` column) via
 * `getWarehouseTokenByHash` — the exact match + isActive semantics are preserved
 * in the server action. No Prisma fallback on a Convex miss.
 *
 * See FEATUREDOCS/54.
 */

type RawToken = Doc<"warehouseDashboardTokens">;

const toDate = (v: number | undefined | null): Date | null =>
  typeof v === "number" ? new Date(v) : null;

export interface WarehouseDashboardTokenRow {
  id: string;
  organizationId: string;
  name: string;
  token: string;
  tokenHash: string;
  locationId: string | null;
  // Prisma `@default(true)` — an absent Convex value means true.
  isActive: boolean;
  // Prisma `@default("standard")`.
  layout: string;
  createdById: string;
  lastAccessedAt: Date | null;
  createdAt: Date | null;
}

export function mapWarehouseToken(d: RawToken): WarehouseDashboardTokenRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    token: d.token,
    tokenHash: d.tokenHash,
    locationId: d.locationId ?? null,
    isActive: d.isActive ?? true,
    layout: d.layout ?? "standard",
    createdById: d.createdById,
    lastAccessedAt: toDate(d.lastAccessedAt),
    createdAt: toDate(d.createdAt),
  };
}

/**
 * All display tokens for an org, newest first — the Convex-read replacement for
 * the Prisma `findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } })`.
 * The `createdAt: desc` ordering is reproduced in JS (absent createdAt sorts last).
 */
export async function getWarehouseTokensByOrg(
  organizationId: string,
): Promise<WarehouseDashboardTokenRow[]> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.warehouseDashboardTokens.list, {
      orgId: organizationId,
    }),
  )) as RawToken[];
  return rows
    .map(mapWarehouseToken)
    .sort((a, b) => {
      const at = a.createdAt ? a.createdAt.getTime() : -Infinity;
      const bt = b.createdAt ? b.createdAt.getTime() : -Infinity;
      return bt - at; // desc
    });
}

/** Single token by cuid (no org scope at the index — caller enforces org). */
export async function getWarehouseTokenById(
  id: string,
): Promise<WarehouseDashboardTokenRow | null> {
  const doc = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.warehouseDashboardTokens.getById, { id }),
  )) as RawToken | null;
  return doc ? mapWarehouseToken(doc) : null;
}

/**
 * Secure lookup by SHA-256 `tokenHash` — the public-endpoint validation path.
 * Replicates the old Prisma `findUnique({ where: { tokenHash } })`. Returns null
 * if no row matches.
 */
export async function getWarehouseTokenByHash(
  tokenHash: string,
): Promise<WarehouseDashboardTokenRow | null> {
  const doc = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.warehouseDashboardTokens.getByTokenHash, {
      tokenHash,
    }),
  )) as RawToken | null;
  return doc ? mapWarehouseToken(doc) : null;
}
