import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { SavedViewConfig } from "@/lib/saved-views";

/**
 * Server-side read helpers for the saved-table-view domain (Phase B Convex-only).
 * Backfilled via scripts/convex-backfill-saved-views.ts.
 *
 * These helpers read the Convex copy and shape it back into the Prisma-row form the
 * saved-view server actions return (epoch-ms → Date, absent optionals → null,
 * Prisma-defaulted columns coerced to non-null). The `config` JSON column passes
 * through untouched.
 *
 * `api.savedTableViews.list({ orgId })` returns EVERY view for the org; the
 * entityType (tableId) + per-user scope + ordering that the old Prisma query
 * applied is reproduced here in pure JS (filterAndSortSavedViews) so it stays
 * unit-testable with no Prisma fallback on a miss.
 */

type RawSavedView = Doc<"savedTableViews">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);

export interface SavedTableViewRow {
  id: string;
  organizationId: string;
  userId: string;
  tableId: string;
  name: string;
  config: SavedViewConfig;
  isDefault: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function mapSavedView(d: RawSavedView): SavedTableViewRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    userId: d.userId,
    tableId: d.tableId,
    name: d.name,
    // `config` is a passthrough JSON column (SavedViewConfig).
    config: (d.config ?? {}) as SavedViewConfig,
    // Prisma column has @default(false); Convex stores it as an optional, so an
    // absent value means false.
    isDefault: d.isDefault ?? false,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/**
 * Reproduce the old Prisma query:
 *   where:   { organizationId, userId, tableId }
 *   orderBy: [{ isDefault: "desc" }, { name: "asc" }]
 *
 * `organizationId` is already satisfied by the Convex `list({ orgId })` query, so
 * this filters the remaining `userId` + `tableId` scope and sorts. Default views
 * sort first; within each group, by name ascending (locale-naive, matching
 * Postgres default text collation closely enough for view names).
 */
export function filterAndSortSavedViews(
  rows: SavedTableViewRow[],
  userId: string,
  tableId: string,
): SavedTableViewRow[] {
  return rows
    .filter((v) => v.userId === userId && v.tableId === tableId)
    .sort((a, b) => {
      // isDefault desc: true (1) before false (0).
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      // name asc.
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });
}

/**
 * The user's saved views for one table, scoped to org + user, default-first then
 * name-ascending — the Convex-read replacement for the Prisma `findMany` in
 * `getSavedViews`.
 */
export async function getSavedViewsForUser(
  organizationId: string,
  userId: string,
  tableId: string,
): Promise<SavedTableViewRow[]> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.savedTableViews.list, { orgId: organizationId }),
  )) as RawSavedView[];
  return filterAndSortSavedViews(rows.map(mapSavedView), userId, tableId);
}
