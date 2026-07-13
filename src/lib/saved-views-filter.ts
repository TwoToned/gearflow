import type { Doc } from "../../convex/_generated/dataModel";
import type { SavedViewConfig } from "@/lib/saved-views";

/**
 * Pure saved-view mapping + filter/sort. Extracted from saved-views-read.ts (which
 * imports getConvexClient and so can't be pulled into a client component) so the
 * browser-direct saved-views menu can derive its list from the reactive
 * `useSavedTableViews` docs without a server round-trip.
 */

export type RawSavedView = Doc<"savedTableViews">;

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
    config: (d.config ?? {}) as SavedViewConfig,
    isDefault: d.isDefault ?? false,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/**
 * Reproduce the old Prisma query (`where { organizationId, userId, tableId }`,
 * `orderBy [{ isDefault desc }, { name asc }]`). `organizationId` is already satisfied
 * by the `list({ orgId })` query, so this filters userId + tableId and sorts.
 */
export function filterAndSortSavedViews(
  rows: SavedTableViewRow[],
  userId: string,
  tableId: string,
): SavedTableViewRow[] {
  return rows
    .filter((v) => v.userId === userId && v.tableId === tableId)
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });
}
