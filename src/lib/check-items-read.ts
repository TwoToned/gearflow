import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Check Items domain (Phase A read-rewiring).
 *
 * CheckItem, ModelCheckItem and KitCheckItem are all dual-written: every
 * create/update/delete writes BOTH the Prisma row (the durable FK anchor —
 * `model_check_item`, `kit_check_item` and `check_record` carry a required +
 * Cascade FK to `check_item`) AND the Convex doc (the reactive read source). These
 * helpers read the pure-read server actions (`getCheckItems`, `getCheckItem`,
 * `getModelCheckItems`, `getKitCheckItems`) from Convex instead of Prisma.
 *
 * Mappers reverse `toConvexDoc`: epoch-ms → Date, absent → null, and
 * Prisma-defaulted columns (`type` default PASS_FAIL, `sortOrder` default 0) are
 * coerced back to their non-null defaults. `dropdownOptions` is a JSON column
 * (`v.any()`) and passes straight through. No Prisma fallback on a Convex miss — a
 * miss reads null/empty, like a join against a deleted row. Cross-domain joins to
 * the auth `User` (createdBy) and to the `Model` table stay on their own sources.
 * See FEATUREDOCS/54.
 */

type ConvexCheckItem = Doc<"checkItems">;
type ConvexModelCheckItem = Doc<"modelCheckItems">;
type ConvexKitCheckItem = Doc<"kitCheckItems">;

/** Public shape of a check item, matching the old Prisma `serialize`d row. */
export interface CheckItemRow {
  id: string;
  organizationId: string;
  label: string;
  description: string | null;
  type: "PASS_FAIL" | "NOTES" | "MEASUREMENT" | "DROPDOWN";
  category: string | null;
  measurementUnit: string | null;
  measurementMin: number | null;
  measurementMax: number | null;
  dropdownOptions: unknown;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A model/kit assignment row with its nested `checkItem`, matching the old
 *  Prisma `include: { checkItem: true }` shape. */
export interface CheckItemAssignmentRow {
  id: string;
  organizationId: string;
  modelId?: string;
  kitId?: string;
  checkItemId: string;
  sortOrder: number;
  createdAt: Date;
  checkItem: CheckItemRow;
}

/** Map a Convex checkItems doc back to the Prisma-shaped row. */
function mapCheckItem(doc: ConvexCheckItem): CheckItemRow {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    label: doc.label,
    description: doc.description ?? null,
    // Prisma column default is PASS_FAIL; toConvexDoc drops the field if it ever
    // equalled the default and was somehow absent, so coerce defensively.
    type: doc.type ?? "PASS_FAIL",
    category: doc.category ?? null,
    measurementUnit: doc.measurementUnit ?? null,
    measurementMin: doc.measurementMin ?? null,
    measurementMax: doc.measurementMax ?? null,
    // JSON column — pass straight through (absent → null).
    dropdownOptions: doc.dropdownOptions ?? null,
    createdById: doc.createdById ?? null,
    createdAt: doc.createdAt != null ? new Date(doc.createdAt) : new Date(0),
    updatedAt: doc.updatedAt != null ? new Date(doc.updatedAt) : new Date(0),
  };
}

// ─── Pure filter/sort predicates (unit-tested) ──────────────────────────────

/**
 * Replicate Prisma `orderBy: [{ category: "asc" }, { label: "asc" }]`. Postgres
 * ASC sorts NULLS LAST, so a null `category` sorts after any present value; ties
 * break on `label` (a required column, never null).
 */
export function sortCheckItemsForLibrary(items: CheckItemRow[]): CheckItemRow[] {
  return [...items].sort((a, b) => {
    const ca = nullsLastAsc(a.category, b.category);
    if (ca !== 0) return ca;
    return a.label.localeCompare(b.label);
  });
}

/** ASC comparator with NULLS LAST (Postgres default for ASC). */
function nullsLastAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/** Replicate Prisma `orderBy: { sortOrder: "asc" }` on assignment rows. */
export function sortAssignmentsBySortOrder<T extends { sortOrder: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
}

// ─── Fetchers ───────────────────────────────────────────────────────────────

/** All check items for an org, sorted like the Prisma library query. */
export async function getCheckItemsForOrg(orgId: string): Promise<CheckItemRow[]> {
  const docs = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.checkItems.list, { orgId }),
  );
  return sortCheckItemsForLibrary(docs.map(mapCheckItem));
}

/** A single check item by id, org-scoped (null when absent or wrong org). */
export async function getCheckItemById(
  orgId: string,
  id: string,
): Promise<CheckItemRow | null> {
  const doc = await (await getConvexClient()).query(api.checkItems.getById, { id });
  if (!doc || doc.organizationId !== orgId) return null;
  return mapCheckItem(doc);
}

/**
 * Per-check-item usage counts (checkItemId → { modelCheckItems, checkRecords })
 * computed in JS over the org's modelCheckItems and checkRecords lists. Both join
 * tables are dual-written, so the whole groupBy/_count moves to Convex. Replaces
 * two Prisma `groupBy({ by: ["checkItemId"], _count })` aggregates.
 */
export async function getCheckItemUsageCounts(
  orgId: string,
): Promise<Record<string, { modelCheckItems: number; checkRecords: number }>> {
  const [modelRows, recordRows] = await Promise.all([
    withConvexReadRetry(async () =>
      (await getConvexClient()).query(api.modelCheckItems.list, { orgId }),
    ),
    withConvexReadRetry(async () =>
      (await getConvexClient()).query(api.checkRecords.list, { orgId }),
    ),
  ]);
  const counts: Record<string, { modelCheckItems: number; checkRecords: number }> = {};
  const ensure = (id: string) => (counts[id] ??= { modelCheckItems: 0, checkRecords: 0 });
  for (const r of modelRows) if (r.checkItemId) ensure(r.checkItemId).modelCheckItems += 1;
  for (const r of recordRows) if (r.checkItemId) ensure(r.checkItemId).checkRecords += 1;
  return counts;
}

/**
 * Model check-item assignments for one model, sorted by sortOrder, each with its
 * nested `checkItem` attached from the org's Convex checkItems list. Replaces
 * Prisma `findMany({ where: { modelId }, include: { checkItem: true } })`.
 */
export async function getModelCheckItemsForModel(
  orgId: string,
  modelId: string,
): Promise<CheckItemAssignmentRow[]> {
  const [assignments, checkItems] = await Promise.all([
    withConvexReadRetry(async () =>
      (await getConvexClient()).query(api.modelCheckItems.listByModelId, { orgId, modelId }),
    ),
    getCheckItemMap(orgId),
  ]);
  return attachCheckItems(assignments, checkItems);
}

/**
 * Kit check-item assignments for one kit, sorted by sortOrder, each with its
 * nested `checkItem`. Replaces Prisma `findMany({ where: { kitId }, include: {
 * checkItem: true } })`.
 */
export async function getKitCheckItemsForKit(
  orgId: string,
  kitId: string,
): Promise<CheckItemAssignmentRow[]> {
  const [assignments, checkItems] = await Promise.all([
    withConvexReadRetry(async () =>
      (await getConvexClient()).query(api.kitCheckItems.listByKitId, { orgId, kitId }),
    ),
    getCheckItemMap(orgId),
  ]);
  return attachCheckItems(assignments, checkItems);
}

/** A raw model assignment row (no nested checkItem), matching the Prisma
 *  `modelCheckItems: true` include on a single check item. */
export interface ModelAssignmentRow {
  id: string;
  organizationId: string;
  modelId: string;
  checkItemId: string;
  sortOrder: number;
  createdAt: Date;
}

/**
 * Raw model assignments for one check item (by checkItemId), no nested checkItem.
 * Replaces the `modelCheckItems: true` include in the Prisma getCheckItem query.
 * No orderBy — the caller re-sorts by resolved model name.
 */
export async function getModelAssignmentsForCheckItem(
  orgId: string,
  checkItemId: string,
): Promise<ModelAssignmentRow[]> {
  const rows = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.modelCheckItems.listByCheckItemId, { orgId, checkItemId }),
  );
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    modelId: r.modelId,
    checkItemId: r.checkItemId,
    sortOrder: r.sortOrder ?? 0,
    createdAt: r.createdAt != null ? new Date(r.createdAt) : new Date(0),
  }));
}

// ─── Attach helper ───────────────────────────────────────────────────────────

/** Org check items keyed by cuid `id`, for attaching to assignment rows. */
async function getCheckItemMap(orgId: string): Promise<Map<string, CheckItemRow>> {
  const items = await getCheckItemsForOrg(orgId);
  return new Map(items.map((i) => [i.id, i]));
}

/**
 * Attach the nested `checkItem` to assignment rows and sort by sortOrder. An
 * assignment whose `checkItem` is absent from the map (a join against a deleted
 * row) is dropped — Prisma's required FK + Cascade delete means such a row can't
 * exist, but we never invent one.
 */
function attachCheckItems(
  assignments: Array<ConvexModelCheckItem | ConvexKitCheckItem>,
  checkItems: Map<string, CheckItemRow>,
): CheckItemAssignmentRow[] {
  const rows: CheckItemAssignmentRow[] = [];
  for (const a of assignments) {
    const checkItem = checkItems.get(a.checkItemId);
    if (!checkItem) continue;
    rows.push({
      id: a.id,
      organizationId: a.organizationId,
      ...("modelId" in a ? { modelId: a.modelId } : {}),
      ...("kitId" in a ? { kitId: a.kitId } : {}),
      checkItemId: a.checkItemId,
      // Prisma column default is 0.
      sortOrder: a.sortOrder ?? 0,
      createdAt: a.createdAt != null ? new Date(a.createdAt) : new Date(0),
      checkItem,
    });
  }
  return sortAssignmentsBySortOrder(rows);
}
