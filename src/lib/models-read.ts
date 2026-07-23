import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Models domain (Phase 3 cutover).
 *
 * Models are dual-written like Suppliers/Locations: every create/update/delete
 * writes BOTH the Prisma `model` row (the durable FK anchor — `asset` and
 * `bulk_asset` carry a **required + Restrict** FK; `model_media`,
 * `model_check_item`, `supplier_model_rate`, `model_bulk_accessory` carry a
 * **required + Cascade** FK; `project_line_item`, `supplier_order_item`,
 * `group_template_item`, `sub_hire_item` carry nullable FKs) AND the Convex
 * `models` doc (the reactive read source the browser subscribes to). Reads that
 * want reactivity — the model list, the model dropdowns, the edit form — go
 * through Convex via this helper / the `use-models` hooks. Cross-domain
 * `model.*` joins (~200 sites across assets / line-items / availability / the
 * PDF pipeline) stay on the always-fresh Prisma mirror and migrate at
 * Prisma-decommission. See FEATUREDOCS/54.
 */
export type ConvexModel = Doc<"models">;

export async function getModelById(id: string): Promise<ConvexModel | null> {
  return await (await getConvexClient()).query(api.models.getById, { id });
}

export async function getModelsByOrg(orgId: string): Promise<ConvexModel[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.models.list, { orgId }),
  );
}

/** All of an org's models keyed by cuid `id`, for attaching to joined rows. */
export async function getModelMap(orgId: string): Promise<Map<string, ConvexModel>> {
  const all = await getModelsByOrg(orgId);
  return new Map(all.map((m) => [m.id, m]));
}

/**
 * Attach a `model` field to rows that carry a `modelId`, replacing a Prisma
 * `include: { model }`. One Convex round-trip per call (the org model map).
 */
export async function attachModel<T extends { modelId: string | null }>(
  orgId: string,
  rows: T[],
): Promise<Array<T & { model: ConvexModel | null }>> {
  if (rows.length === 0) return [];
  const map = await getModelMap(orgId);
  return rows.map((r) => ({
    ...r,
    model: r.modelId ? map.get(r.modelId) ?? null : null,
  }));
}

/* ------------------------------------------------------------------------- *
 * getModels list read — pure filter/sort/paginate over the Convex model list
 *
 * Replaces the Prisma `model.findMany` + `model.count` in
 * `server/models.ts#getModels`. The Convex `models.list({orgId})` query returns
 * ALL of an org's models (active + archived), so the Prisma `where`
 * (isActive / categoryId / assetType / search) and `orderBy` are re-applied in
 * JS here. Cross-domain `category` (dual-written) is attached via
 * getModelWithCategoryMap; per-model asset/bulk counts + primary photo come off
 * the already-Convex getModelCounts (assets/bulkAssets mirror + modelMedia
 * mirror). No Prisma fallback on a Convex map miss.
 * ------------------------------------------------------------------------- */

/** A Convex model row reshaped to the Prisma `Model` row shape consumers expect:
 *  epoch-ms timestamps → Date; Prisma-defaulted columns coerced non-null. */
export type ModelRow = Omit<ConvexModel, "_id" | "_creationTime" | "createdAt" | "updatedAt"> & {
  images: string[];
  manuals: string[];
  tags: string[];
  assetType: "SERIALIZED" | "BULK";
  requiresTestAndTag: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Map a Convex `models` doc to the Prisma-row shape: strip Convex system fields,
 *  convert epoch-ms → Date (serialize keeps Date), coerce Prisma-defaulted
 *  columns (`images`/`manuals`/`tags`/`assetType`/`requiresTestAndTag`/
 *  `isActive`) to their non-null defaults. */
export function mapConvexModelToRow(m: ConvexModel): ModelRow {
  const {
    _id: _convexId,
    _creationTime: _convexCreated,
    createdAt,
    updatedAt,
    images,
    manuals,
    tags,
    assetType,
    requiresTestAndTag,
    isActive,
    ...rest
  } = m;
  void _convexId;
  void _convexCreated;
  return {
    ...rest,
    images: images ?? [],
    manuals: manuals ?? [],
    tags: tags ?? [],
    assetType: assetType ?? "SERIALIZED",
    requiresTestAndTag: requiresTestAndTag ?? false,
    isActive: isActive ?? true,
    createdAt: createdAt != null ? new Date(createdAt) : new Date(0),
    updatedAt: updatedAt != null ? new Date(updatedAt) : new Date(0),
  };
}

export interface ModelListFilter {
  isActive?: boolean;
  categoryId?: string;
  assetType?: "SERIALIZED" | "BULK";
  search?: string;
}

/** Replicate the Prisma `where` of getModels in JS: isActive (defaulted true),
 *  optional categoryId / assetType, and the OR case-insensitive `contains`
 *  search over name / manufacturer / modelNumber / sku. */
export function filterModels(models: ModelRow[], filter: ModelListFilter): ModelRow[] {
  const isActive = filter.isActive ?? true;
  const search = filter.search?.toLowerCase().trim();
  return models.filter((m) => {
    if (m.isActive !== isActive) return false;
    if (filter.categoryId && m.categoryId !== filter.categoryId) return false;
    if (filter.assetType && m.assetType !== filter.assetType) return false;
    if (search) {
      const hay = [m.name, m.manufacturer, m.modelNumber, m.sku]
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.toLowerCase());
      if (!hay.some((s) => s.includes(search))) return false;
    }
    return true;
  });
}

// Declared-order rank for the AssetType Postgres enum (sorts by DECLARED order,
// not alphabetical). Keep in sync with prisma/schema.prisma `enum AssetType`.
const ASSET_TYPE_RANK: Record<string, number> = { SERIALIZED: 0, BULK: 1 };

/** Final (direction-applied) comparison of two possibly-null values with
 *  Postgres null ordering: ASC = NULLS LAST, DESC = NULLS FIRST. The null
 *  branches return their final sign directly (not direction-flipped by the
 *  caller); only the non-null `cmp` result is oriented by `dir`. */
function compareNullable(
  av: unknown,
  bv: unknown,
  dir: "asc" | "desc",
  cmp: (a: NonNullable<unknown>, b: NonNullable<unknown>) => number,
): number {
  const an = av == null;
  const bn = bv == null;
  if (an && bn) return 0;
  // ASC → nulls last (null after non-null); DESC → nulls first (null before).
  if (an) return dir === "asc" ? 1 : -1;
  if (bn) return dir === "asc" ? -1 : 1;
  return (dir === "desc" ? -1 : 1) * cmp(av as NonNullable<unknown>, bv as NonNullable<unknown>);
}

/** Replicate the Prisma `orderBy` of getModels. `sortBy === "category"` sorts by
 *  the attached category name (provided via categoryNameOf); enum columns use a
 *  declared-order rank; numeric columns compare numerically; everything else
 *  compares as a case-insensitive string. Stable (Array.prototype.sort is). */
export function sortModels(
  models: ModelRow[],
  sortBy: string,
  sortOrder: "asc" | "desc",
  categoryNameOf?: (m: ModelRow) => string | null,
): ModelRow[] {
  const numericFields = new Set([
    "defaultRentalPrice",
    "dailyRate",
    "weeklyRate",
    "monthlyRate",
    "defaultPurchasePrice",
    "replacementCost",
    "weight",
    "powerDraw",
    "maintenanceIntervalDays",
    "testAndTagIntervalDays",
  ]);
  const valueOf = (m: ModelRow): unknown => {
    if (sortBy === "category") return categoryNameOf ? categoryNameOf(m) : null;
    if (sortBy === "assetType") return ASSET_TYPE_RANK[m.assetType] ?? null;
    return (m as unknown as Record<string, unknown>)[sortBy];
  };
  const isNumeric = numericFields.has(sortBy) || sortBy === "assetType";
  return [...models].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    return compareNullable(av, bv, sortOrder, (x, y) =>
      isNumeric
        ? Number(x) - Number(y)
        : String(x).localeCompare(String(y), undefined, { sensitivity: "base" }),
    );
  });
}

/** Slice a page (1-based) out of the sorted list. */
export function paginateModels<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}
