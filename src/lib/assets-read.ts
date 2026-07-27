import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Prisma } from "@/generated/prisma/client";

// The Asset/BulkAsset Prisma models are dropped (domain data is Convex-native).
// These local types preserve the exact Prisma scalar-row shape the mapping
// helpers below emit and the filter helpers consume, so downstream behaviour is
// unchanged. Derived from `Doc<"assets">`/`Doc<"bulkAssets">` (R-8.2.4) rather
// than hand-duplicated field-by-field, so a schema change is a compile error
// here instead of a silently-stale shape.
type Asset = Omit<
  Doc<"assets">,
  | "_id"
  | "_creationTime"
  | "serialNumber"
  | "customName"
  | "status"
  | "condition"
  | "purchaseDate"
  | "purchasePrice"
  | "purchaseSupplier"
  | "supplierId"
  | "purchaseOrderNumber"
  | "supplierOrderId"
  | "warrantyExpiry"
  | "notes"
  | "locationId"
  | "customFieldValues"
  | "lastTestAndTagDate"
  | "nextTestAndTagDate"
  | "barcode"
  | "qrCode"
  | "images"
  | "tags"
  | "isActive"
  | "createdAt"
  | "updatedAt"
  | "kitId"
  | "parentAssetId"
> & {
  serialNumber: string | null;
  customName: string | null;
  status: string;
  condition: string;
  purchaseDate: Date | null;
  purchasePrice: Prisma.Decimal | null;
  purchaseSupplier: string | null;
  supplierId: string | null;
  purchaseOrderNumber: string | null;
  supplierOrderId: string | null;
  warrantyExpiry: Date | null;
  notes: string | null;
  locationId: string | null;
  customFieldValues: Prisma.JsonValue | null;
  lastTestAndTagDate: Date | null;
  nextTestAndTagDate: Date | null;
  barcode: string | null;
  qrCode: string | null;
  images: string[];
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  kitId: string | null;
  parentAssetId: string | null;
};

type BulkAsset = Omit<
  Doc<"bulkAssets">,
  | "_id"
  | "_creationTime"
  | "totalQuantity"
  | "availableQuantity"
  | "purchasePricePerUnit"
  | "locationId"
  | "status"
  | "notes"
  | "tags"
  | "isActive"
  | "createdAt"
  | "updatedAt"
> & {
  totalQuantity: number;
  availableQuantity: number;
  purchasePricePerUnit: Prisma.Decimal | null;
  locationId: string | null;
  status: string;
  notes: string | null;
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Server-side read helpers for the Asset + BulkAsset domains (Phase 3 cutover).
 *
 * Both are dual-written (see src/lib/asset-mirror.ts). Reactive reads — the
 * registry table, the asset/bulk edit forms — go through Convex via the
 * `use-assets` hooks. Cross-domain `asset.*` / `bulkAsset.*` joins (T&T, scan,
 * check, damage, line-item composition, the PDF pipeline) stay on the
 * always-fresh Prisma mirror and migrate at Prisma-decommission. See FEATUREDOCS/54.
 */
export type ConvexAsset = Doc<"assets">;
export type ConvexBulkAsset = Doc<"bulkAssets">;

export async function getAssetById(id: string): Promise<ConvexAsset | null> {
  return await (await getConvexClient()).query(api.assets.getById, { id });
}

export async function getAssetsByOrg(orgId: string): Promise<ConvexAsset[]> {
  return await (await getConvexClient()).query(api.assets.list, { orgId });
}

export async function getBulkAssetById(id: string): Promise<ConvexBulkAsset | null> {
  return await (await getConvexClient()).query(api.bulkAssets.getById, { id });
}

export async function getBulkAssetsByOrg(orgId: string): Promise<ConvexBulkAsset[]> {
  return await (await getConvexClient()).query(api.bulkAssets.list, { orgId });
}

/**
 * Scoped counterparts of getAssetsByOrg / getBulkAssetsByOrg: read only the rows
 * a composite references by id (e.g. a project's line-item assets), instead of the
 * whole org registry. Chunked at 1000 (the listByIds cap) so a large project can't
 * hit it. Same raw doc shape, so callers' maps are unchanged.
 */
export async function getAssetsByIds(orgId: string, ids: string[]): Promise<ConvexAsset[]> {
  if (ids.length === 0) return [];
  const convex = await getConvexClient();
  const out: ConvexAsset[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    out.push(...(await convex.query(api.assets.listByIds, { orgId, ids: ids.slice(i, i + 1000) })));
  }
  return out;
}

export async function getBulkAssetsByIds(orgId: string, ids: string[]): Promise<ConvexBulkAsset[]> {
  if (ids.length === 0) return [];
  const convex = await getConvexClient();
  const out: ConvexBulkAsset[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    out.push(...(await convex.query(api.bulkAssets.listByIds, { orgId, ids: ids.slice(i, i + 1000) })));
  }
  return out;
}

export async function getAssetByAssetTag(orgId: string, assetTag: string): Promise<ConvexAsset | null> {
  return await (await getConvexClient()).query(api.assets.getByAssetTag, { organizationId: orgId, assetTag });
}

export async function getBulkAssetByAssetTag(orgId: string, assetTag: string): Promise<ConvexBulkAsset | null> {
  return await (await getConvexClient()).query(api.bulkAssets.getByAssetTag, { organizationId: orgId, assetTag });
}

export async function getActiveAssetsByModel(modelId: string, orgId: string): Promise<ConvexAsset[]> {
  const all = (await (await getConvexClient()).query(api.assets.listByModel, { modelId, orgId })) as ConvexAsset[];
  return all.filter((a) => a.isActive !== false);
}

export async function getActiveBulkAssetsByModel(modelId: string, orgId: string): Promise<ConvexBulkAsset[]> {
  const all = (await (await getConvexClient()).query(api.bulkAssets.listByModel, { modelId, orgId })) as ConvexBulkAsset[];
  return all.filter((ba) => ba.isActive !== false);
}

// ---------------------------------------------------------------------------
// Pure filter/sort predicates (unit-tested) replicating the Prisma `where` /
// `orderBy` clauses of the kit-availability and container-search reads now that
// the asset rows come off Convex. Prisma defaults are coerced because the Convex
// doc leaves defaulted columns absent: `status` (Asset default AVAILABLE /
// BulkAsset default ACTIVE), `isActive` (default true), `availableQuantity`
// (default 0). `assetTag` is a required non-null column, so the ASC sort never
// hits NULLS-LAST.
// ---------------------------------------------------------------------------

/** Stable ASC sort by `assetTag` (Prisma `orderBy: { assetTag: "asc" }`). */
export function sortByAssetTagAsc<T extends { assetTag: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.assetTag < b.assetTag ? -1 : a.assetTag > b.assetTag ? 1 : 0));
}

/**
 * Serialized assets eligible to be added to a kit: active, AVAILABLE, not already
 * in a kit, optionally filtered to one model. Replicates
 * `where: { isActive: true, status: "AVAILABLE", kitId: null, ...(modelId && { modelId }) }`.
 */
export function filterAvailableAssetsForKit(assets: ConvexAsset[], modelId?: string): ConvexAsset[] {
  return assets.filter(
    (a) =>
      a.isActive !== false &&
      (a.status ?? "AVAILABLE") === "AVAILABLE" &&
      (a.kitId ?? null) === null &&
      (!modelId || a.modelId === modelId),
  );
}

/**
 * Bulk assets eligible to be added to a kit: active, ACTIVE status, with spare
 * quantity. Replicates
 * `where: { isActive: true, status: "ACTIVE", availableQuantity: { gt: 0 } }`.
 */
export function filterAvailableBulkAssetsForKit(bulkAssets: ConvexBulkAsset[]): ConvexBulkAsset[] {
  return bulkAssets.filter(
    (b) =>
      b.isActive !== false &&
      (b.status ?? "ACTIVE") === "ACTIVE" &&
      (b.availableQuantity ?? 0) > 0,
  );
}

/**
 * Container-search match predicate: assets whose model's category is in
 * `categoryIds`, optionally matching `query` (case-insensitive substring)
 * against `assetTag`, `customName`, or the model name. Replicates the
 * `searchContainerAssets` Prisma `where` — the `model: { categoryId: { in } }`
 * relational filter plus the OR text filter. `modelCategoryId` / `modelName`
 * resolve the joined model fields from the Convex model map; an asset whose model
 * can't be resolved fails the category gate (a join against a deleted/absent row,
 * same as Prisma's inner relational filter).
 */
export function filterContainerAssets(
  assets: ConvexAsset[],
  categoryIds: Set<string>,
  query: string,
  modelCategoryId: (modelId: string | null | undefined) => string | null,
  modelName: (modelId: string | null | undefined) => string | null,
): ConvexAsset[] {
  const needle = query.toLowerCase();
  return assets.filter((a) => {
    const catId = modelCategoryId(a.modelId);
    if (!catId || !categoryIds.has(catId)) return false;
    if (!needle) return true;
    return (
      a.assetTag.toLowerCase().includes(needle) ||
      (a.customName?.toLowerCase().includes(needle) ?? false) ||
      (modelName(a.modelId)?.toLowerCase().includes(needle) ?? false)
    );
  });
}

/* ------------------------------------------------------------------ *
 * Primary list reads (server/assets.ts:getAssets, server/bulk-assets.ts:
 * getBulkAssets) — Convex-backed replacements for the paginated
 * prisma.asset.findMany / prisma.bulkAsset.findMany + count.
 *
 * Convex `list({orgId})` returns ALL rows for the org → filter/sort/paginate
 * in JS, replicating the old Prisma where/orderBy. Convex docs carry numeric
 * epoch-ms dates and plain-number Decimals (absent → undefined); the mappers
 * rebuild the Prisma row shape (Date, Decimal, defaulted-non-null columns) so
 * the existing `AssetWithRelations` / `BulkAssetWithRelations` consumers (the
 * T&T new-record form) read the same field names as before. No Prisma fallback
 * on a miss — a missing Convex row reads as absent (the mirror is the source of
 * truth post-cutover). See FEATUREDOCS/54.
 * ------------------------------------------------------------------ */

function msToDate(ms: number | null | undefined): Date | null {
  return ms == null ? null : new Date(ms);
}

// Postgres enum columns sort by DECLARED order, not alphabetical. Rank maps
// replicate prisma/schema.prisma declaration order for orderBy on enum fields.
const ASSET_STATUS_RANK: Record<string, number> = {
  AVAILABLE: 0, CHECKED_OUT: 1, IN_MAINTENANCE: 2, RETIRED: 3, LOST: 4, RESERVED: 5, SOLD: 6,
};
const ASSET_CONDITION_RANK: Record<string, number> = {
  NEW: 0, GOOD: 1, FAIR: 2, POOR: 3, DAMAGED: 4,
};
const BULK_ASSET_STATUS_RANK: Record<string, number> = {
  ACTIVE: 0, LOW_STOCK: 1, OUT_OF_STOCK: 2, RETIRED: 3,
};

/**
 * Map a Convex `assets` doc to the Prisma `Asset` scalar row shape. Strips
 * `_id`/`_creationTime`; coerces Prisma-defaulted columns non-null
 * (status/condition/isActive/images/tags); epoch-ms → Date; number → Decimal.
 */
export function mapConvexAssetToPrisma(doc: ConvexAsset): Asset {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    modelId: doc.modelId,
    assetTag: doc.assetTag,
    serialNumber: doc.serialNumber ?? null,
    customName: doc.customName ?? null,
    status: (doc.status ?? "AVAILABLE") as Asset["status"],
    condition: (doc.condition ?? "NEW") as Asset["condition"],
    purchaseDate: msToDate(doc.purchaseDate),
    purchasePrice:
      doc.purchasePrice == null ? null : new Prisma.Decimal(doc.purchasePrice),
    purchaseSupplier: doc.purchaseSupplier ?? null,
    supplierId: doc.supplierId ?? null,
    purchaseOrderNumber: doc.purchaseOrderNumber ?? null,
    supplierOrderId: doc.supplierOrderId ?? null,
    warrantyExpiry: msToDate(doc.warrantyExpiry),
    notes: doc.notes ?? null,
    locationId: doc.locationId ?? null,
    customFieldValues: (doc.customFieldValues ?? null) as Asset["customFieldValues"],
    lastTestAndTagDate: msToDate(doc.lastTestAndTagDate),
    nextTestAndTagDate: msToDate(doc.nextTestAndTagDate),
    barcode: doc.barcode ?? null,
    qrCode: doc.qrCode ?? null,
    images: doc.images ?? [],
    tags: doc.tags ?? [],
    isActive: doc.isActive ?? true,
    createdAt: msToDate(doc.createdAt) ?? new Date(0),
    updatedAt: msToDate(doc.updatedAt) ?? new Date(0),
    kitId: doc.kitId ?? null,
    parentAssetId: doc.parentAssetId ?? null,
  };
}

/**
 * Map a Convex `bulkAssets` doc to the Prisma `BulkAsset` scalar row shape.
 */
export function mapConvexBulkAssetToPrisma(doc: ConvexBulkAsset): BulkAsset {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    modelId: doc.modelId,
    assetTag: doc.assetTag,
    totalQuantity: doc.totalQuantity ?? 0,
    availableQuantity: doc.availableQuantity ?? 0,
    purchasePricePerUnit:
      doc.purchasePricePerUnit == null ? null : new Prisma.Decimal(doc.purchasePricePerUnit),
    locationId: doc.locationId ?? null,
    status: (doc.status ?? "ACTIVE") as BulkAsset["status"],
    notes: doc.notes ?? null,
    tags: doc.tags ?? [],
    isActive: doc.isActive ?? true,
    createdAt: msToDate(doc.createdAt) ?? new Date(0),
    updatedAt: msToDate(doc.updatedAt) ?? new Date(0),
  };
}

export interface AssetListFilter {
  search?: string;
  categoryId?: string;
  status?: string;
  condition?: string;
  locationId?: string;
  modelId?: string;
  isActive: boolean;
  /** enum `in` filters from the DataTable: status/condition/locationId/categoryId. */
  statusIn?: string[];
  conditionIn?: string[];
  locationIdIn?: string[];
  categoryIdIn?: string[];
  /** tags `hasSome`. */
  tagsHasSome?: string[];
}

export interface BulkAssetListFilter {
  search?: string;
  categoryId?: string;
  status?: string;
  locationId?: string;
  modelId?: string;
  isActive: boolean;
}

function matchesSearch(haystacks: (string | null | undefined)[], search: string): boolean {
  const needle = search.toLowerCase();
  return haystacks.some((h) => (h ?? "").toLowerCase().includes(needle));
}

/**
 * Replicates the Prisma `where` for getAssets. `categoryFor(modelId)` resolves a
 * model's categoryId (the Convex model map), `modelNameFor(modelId)` its name —
 * used by the categoryId filter and the model.name search OR-branch.
 */
export function filterAssets(
  rows: Asset[],
  f: AssetListFilter,
  modelNameFor: (modelId: string) => string | null | undefined,
  categoryFor: (modelId: string) => string | null | undefined,
): Asset[] {
  return rows.filter((a) => {
    if (a.isActive !== f.isActive) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.condition && a.condition !== f.condition) return false;
    if (f.locationId && a.locationId !== f.locationId) return false;
    if (f.modelId && a.modelId !== f.modelId) return false;
    if (f.categoryId && categoryFor(a.modelId) !== f.categoryId) return false;
    if (f.statusIn && f.statusIn.length > 0 && !f.statusIn.includes(a.status)) return false;
    if (f.conditionIn && f.conditionIn.length > 0 && !f.conditionIn.includes(a.condition)) return false;
    if (f.locationIdIn && f.locationIdIn.length > 0 && !(a.locationId != null && f.locationIdIn.includes(a.locationId))) return false;
    if (f.categoryIdIn && f.categoryIdIn.length > 0) {
      const cat = categoryFor(a.modelId);
      if (!(cat != null && f.categoryIdIn.includes(cat))) return false;
    }
    if (f.tagsHasSome && f.tagsHasSome.length > 0 && !a.tags.some((t) => f.tagsHasSome!.includes(t))) return false;
    if (f.search && !matchesSearch([a.assetTag, a.serialNumber, a.customName, modelNameFor(a.modelId)], f.search)) return false;
    return true;
  });
}

/** Replicates the Prisma `where` for getBulkAssets. */
export function filterBulkAssets(
  rows: BulkAsset[],
  f: BulkAssetListFilter,
  modelNameFor: (modelId: string) => string | null | undefined,
  categoryFor: (modelId: string) => string | null | undefined,
): BulkAsset[] {
  return rows.filter((b) => {
    if (b.isActive !== f.isActive) return false;
    if (f.status && b.status !== f.status) return false;
    if (f.locationId && b.locationId !== f.locationId) return false;
    if (f.modelId && b.modelId !== f.modelId) return false;
    if (f.categoryId && categoryFor(b.modelId) !== f.categoryId) return false;
    if (f.search && !matchesSearch([b.assetTag, modelNameFor(b.modelId)], f.search)) return false;
    return true;
  });
}

function compareValues(av: unknown, bv: unknown, dir: 1 | -1): number {
  // Postgres default NULLS LAST for ASC, NULLS FIRST for DESC.
  const aNull = av == null;
  const bNull = bv == null;
  if (aNull && bNull) return 0;
  if (aNull) return dir === 1 ? 1 : -1;
  if (bNull) return dir === 1 ? -1 : 1;
  if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * dir;
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
  if (typeof av === "boolean" && typeof bv === "boolean") {
    return ((av ? 1 : 0) - (bv ? 1 : 0)) * dir;
  }
  return String(av).localeCompare(String(bv)) * dir;
}

/**
 * Replicates the Prisma `orderBy` for getAssets. `model` sorts on model.name,
 * `location` on location.name, enum fields by declared order, else the scalar.
 */
export function sortAssets(
  rows: Asset[],
  sortBy: string,
  sortOrder: "asc" | "desc",
  modelNameFor: (modelId: string) => string | null | undefined,
  locationNameFor: (locationId: string | null) => string | null | undefined,
): Asset[] {
  const dir: 1 | -1 = sortOrder === "desc" ? -1 : 1;
  const keyFn = (a: Asset): unknown => {
    if (sortBy === "model") return modelNameFor(a.modelId);
    if (sortBy === "location") return locationNameFor(a.locationId);
    if (sortBy === "status") return ASSET_STATUS_RANK[a.status];
    if (sortBy === "condition") return ASSET_CONDITION_RANK[a.condition];
    return (a as unknown as Record<string, unknown>)[sortBy];
  };
  return [...rows].sort((a, b) => compareValues(keyFn(a), keyFn(b), dir));
}

/** Replicates the Prisma `orderBy` for getBulkAssets. */
export function sortBulkAssets(
  rows: BulkAsset[],
  sortBy: string,
  sortOrder: "asc" | "desc",
  modelNameFor: (modelId: string) => string | null | undefined,
  locationNameFor: (locationId: string | null) => string | null | undefined,
): BulkAsset[] {
  const dir: 1 | -1 = sortOrder === "desc" ? -1 : 1;
  const keyFn = (b: BulkAsset): unknown => {
    if (sortBy === "model") return modelNameFor(b.modelId);
    if (sortBy === "location") return locationNameFor(b.locationId);
    if (sortBy === "status") return BULK_ASSET_STATUS_RANK[b.status];
    return (b as unknown as Record<string, unknown>)[sortBy];
  };
  return [...rows].sort((a, b) => compareValues(keyFn(a), keyFn(b), dir));
}

/** skip/take pagination (1-based page). */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
}

/** Fetch + map every org asset to the Prisma row shape (pre-filter). */
export async function getMappedAssetsByOrg(orgId: string): Promise<Asset[]> {
  const docs = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.assets.list, { orgId }),
  );
  return (docs as ConvexAsset[]).map(mapConvexAssetToPrisma);
}

/** Fetch + map every org bulk asset to the Prisma row shape (pre-filter). */
export async function getMappedBulkAssetsByOrg(orgId: string): Promise<BulkAsset[]> {
  const docs = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.bulkAssets.list, { orgId }),
  );
  return (docs as ConvexBulkAsset[]).map(mapConvexBulkAssetToPrisma);
}
