/**
 * CLIENT-SAFE pure reconstruction of getProject's equipment tree.
 *
 * This module has ZERO server imports (no getConvexClient / prisma / *-read I/O
 * helpers) so it can be imported by a browser component — the native read-layer
 * cutover (Phase 1d) calls `reconstructProjectEquipmentTree` on a
 * `useQuery(api.projectEquipment.browserBundle)` result client-side, exactly as
 * the server `buildProjectEquipmentTree` does on the service bundle. The mappers +
 * tree-attach helpers were MOVED here from project-line-item-read.ts /
 * line-item-tree-read.ts (which keep server-only co-residents) and are re-exported
 * from those modules for back-compat — so behaviour is parity-by-construction.
 *
 * Pure dependency only: the reconstruction PRIMITIVES (indexChildren / indexUnits /
 * reconstructScope / reconstructCategories) already live in the pure
 * project-line-item-tree-read.ts. Convex doc + entity types are `import type`
 * (erased — safe to reference impure modules for types).
 */
import type { Doc } from "../../convex/_generated/dataModel";
import type { api } from "../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { ConvexAsset, ConvexBulkAsset } from "@/lib/assets-read";
import type { ConvexKit } from "@/lib/kits-read";
import type { ConvexModel } from "@/lib/models-read";
import type { ConvexSupplier } from "@/lib/suppliers-read";
import type { ConvexCategory } from "@/lib/categories-read";
import {
  indexChildren,
  indexUnits,
  reconstructScope,
  reconstructCategories,
} from "@/lib/project-line-item-tree-read";

type LineItemDoc = Doc<"projectLineItems">;
type UnitDoc = Doc<"projectLineItemUnits">;
type CategoryDoc = Doc<"projectCategories">;
type GroupDoc = Doc<"projectGroups">;

// ─── Date helpers ───────────────────────────────────────────────────────────

/** epoch-ms (Convex) → `Date`; absent/`null` → `null`. */
function msToDate(n: number | null | undefined): Date | null {
  return n == null ? null : new Date(n);
}

/** Strip Convex meta + convert the listed epoch-ms keys to `Date` (absent → key
 *  preserved as-is). Used for nested asset/bulkAsset/kit. */
function stripMetaWithDates<T extends Record<string, unknown>>(
  doc: T,
  dateKeys: readonly string[],
): Omit<T, "_id" | "_creationTime"> {
  const { _id, _creationTime, ...rest } = doc as Record<string, unknown>;
  void _id;
  void _creationTime;
  for (const k of dateKeys) {
    if (rest[k] != null) rest[k] = new Date(rest[k] as number);
  }
  return rest as Omit<T, "_id" | "_creationTime">;
}

const ASSET_DATE_KEYS = [
  "purchaseDate",
  "warrantyExpiry",
  "lastTestAndTagDate",
  "nextTestAndTagDate",
  "createdAt",
  "updatedAt",
] as const;
const BULK_ASSET_DATE_KEYS = ["lastReorderedAt", "createdAt", "updatedAt"] as const;
const KIT_DATE_KEYS = ["purchaseDate", "createdAt", "updatedAt"] as const;

// ─── Model / supplier attach (moved from line-item-tree-read.ts) ────────────

export type AttachedModel = ConvexModel & { category: ConvexCategory | null };

export interface LineItemAttachMaps {
  models: Map<string, ConvexModel>;
  suppliers: Map<string, ConvexSupplier>;
  categories: Map<string, ConvexCategory>;
}

/** Resolve a `modelId` to a Convex model doc with its category nested, or null. */
export function resolveAttachedModel(
  modelId: string | null | undefined,
  maps: LineItemAttachMaps,
): AttachedModel | null {
  if (!modelId) return null;
  const model = maps.models.get(modelId);
  if (!model) return null;
  const category = model.categoryId ? maps.categories.get(model.categoryId) ?? null : null;
  return { ...model, category };
}

/** Resolve a `supplierId` to a Convex supplier doc, or null. */
export function resolveAttachedSupplier(
  supplierId: string | null | undefined,
  maps: LineItemAttachMaps,
): ConvexSupplier | null {
  if (!supplierId) return null;
  return maps.suppliers.get(supplierId) ?? null;
}

/** The minimal structural shape a line-item node must expose to be attachable. */
type LineItemNode = {
  modelId?: string | null;
  supplierId?: string | null;
  childLineItems?: unknown;
};

export type AttachedLineItem<T> = Omit<T, "model" | "supplier"> & {
  model: AttachedModel | null;
  supplier: ConvexSupplier | null;
};

/**
 * Walk a `lineItems → childLineItems` tree and attach `model` (with nested
 * `category`) + `supplier` from the Convex maps onto every node, recursing into
 * `childLineItems`. Returns a new array; input rows are not mutated.
 */
export function attachLineItemTree<T extends LineItemNode>(
  rows: T[],
  maps: LineItemAttachMaps,
): Array<AttachedLineItem<T>> {
  return rows.map((row) => {
    const children = row.childLineItems;
    return {
      ...row,
      model: resolveAttachedModel(row.modelId, maps),
      supplier: resolveAttachedSupplier(row.supplierId, maps),
      ...(Array.isArray(children)
        ? { childLineItems: attachLineItemTree(children as LineItemNode[], maps) }
        : {}),
    };
  }) as Array<AttachedLineItem<T>>;
}

// ─── Line-item / unit / category / group mappers (moved from
//     project-line-item-read.ts) ─────────────────────────────────────────────

/** A line item mapped from its Convex doc into the Prisma row shape getProject
 *  expects (every scalar present, dates as `Date`, nullable absent → `null`). */
export interface MappedLineItem {
  id: string;
  organizationId: string;
  projectId: string;
  type: string;
  modelId: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  kitId: string | null;
  isKitChild: boolean;
  childKind: string | null;
  parentLineItemId: string | null;
  pricingMode: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  pricingType: string;
  duration: number;
  discount: number | null;
  lineTotal: number | null;
  priceBreakdown: string | null;
  priceOverridden: boolean;
  overrideReason: string | null;
  sortOrder: number;
  groupName: string | null;
  categoryId: string | null;
  groupId: string | null;
  notes: string | null;
  isOptional: boolean;
  status: string;
  checkedOutQuantity: number;
  returnedQuantity: number;
  assignedQuantity: number;
  packedQuantity: number;
  damagedQuantity: number;
  lostQuantity: number;
  checkedOutAt: Date | null;
  checkedOutById: string | null;
  returnedAt: Date | null;
  returnedById: string | null;
  returnCondition: string | null;
  returnNotes: string | null;
  prepStatus: string | null;
  prepContainer: string | null;
  isContainerLineItem: boolean;
  isCustomItem: boolean;
  returnStatus: string | null;
  showSubhireOnDocs: boolean;
  supplierId: string | null;
  subhireOrderNumber: string | null;
  supplierOrderId: string | null;
  subHireId: string | null;
  subHireItemId: string | null;
  subHireGroupId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Map a Convex `projectLineItems` doc → the full Prisma line-item row shape. */
export function mapLineItemDoc(d: LineItemDoc): MappedLineItem {
  return {
    id: d.id,
    organizationId: d.organizationId,
    projectId: d.projectId,
    type: d.type ?? "EQUIPMENT",
    modelId: d.modelId ?? null,
    assetId: d.assetId ?? null,
    bulkAssetId: d.bulkAssetId ?? null,
    kitId: d.kitId ?? null,
    isKitChild: d.isKitChild ?? false,
    childKind: d.childKind ?? null,
    parentLineItemId: d.parentLineItemId ?? null,
    pricingMode: d.pricingMode ?? null,
    description: d.description ?? null,
    quantity: d.quantity ?? 1,
    unitPrice: d.unitPrice ?? null,
    pricingType: d.pricingType ?? "PER_DAY",
    duration: d.duration ?? 1,
    discount: d.discount ?? null,
    lineTotal: d.lineTotal ?? null,
    priceBreakdown: d.priceBreakdown ?? null,
    priceOverridden: d.priceOverridden ?? false,
    overrideReason: d.overrideReason ?? null,
    sortOrder: d.sortOrder ?? 0,
    groupName: d.groupName ?? null,
    categoryId: d.categoryId ?? null,
    groupId: d.groupId ?? null,
    notes: d.notes ?? null,
    isOptional: d.isOptional ?? false,
    status: d.status ?? "QUOTED",
    checkedOutQuantity: d.checkedOutQuantity ?? 0,
    returnedQuantity: d.returnedQuantity ?? 0,
    assignedQuantity: d.assignedQuantity ?? 0,
    packedQuantity: d.packedQuantity ?? 0,
    damagedQuantity: d.damagedQuantity ?? 0,
    lostQuantity: d.lostQuantity ?? 0,
    checkedOutAt: msToDate(d.checkedOutAt),
    checkedOutById: d.checkedOutById ?? null,
    returnedAt: msToDate(d.returnedAt),
    returnedById: d.returnedById ?? null,
    returnCondition: d.returnCondition ?? null,
    returnNotes: d.returnNotes ?? null,
    prepStatus: d.prepStatus ?? null,
    prepContainer: d.prepContainer ?? null,
    isContainerLineItem: d.isContainerLineItem ?? false,
    isCustomItem: d.isCustomItem ?? false,
    returnStatus: d.returnStatus ?? null,
    showSubhireOnDocs: d.showSubhireOnDocs ?? false,
    supplierId: d.supplierId ?? null,
    subhireOrderNumber: d.subhireOrderNumber ?? null,
    supplierOrderId: d.supplierOrderId ?? null,
    subHireId: d.subHireId ?? null,
    subHireItemId: d.subHireItemId ?? null,
    subHireGroupId: d.subHireGroupId ?? null,
    createdAt: msToDate(d.createdAt),
    updatedAt: msToDate(d.updatedAt),
  };
}

export interface MappedUnit {
  id: string;
  organizationId: string;
  lineItemId: string;
  ordinal: number;
  assetId: string | null;
  bulkAssetId: string | null;
  parentUnitAssetId: string | null;
  quantity: number;
  returnedQuantity: number;
  status: string;
  prepStatus: string | null;
  prepContainer: string | null;
  checkedOutAt: Date | null;
  checkedOutById: string | null;
  returnedAt: Date | null;
  returnedById: string | null;
  returnCondition: string | null;
  returnStatus: string | null;
  returnNotes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Map a Convex `projectLineItemUnits` doc → the Prisma unit row shape. */
export function mapUnitDoc(d: UnitDoc): MappedUnit {
  return {
    id: d.id,
    organizationId: d.organizationId,
    lineItemId: d.lineItemId,
    ordinal: d.ordinal,
    assetId: d.assetId ?? null,
    bulkAssetId: d.bulkAssetId ?? null,
    parentUnitAssetId: d.parentUnitAssetId ?? null,
    quantity: d.quantity ?? 1,
    returnedQuantity: d.returnedQuantity ?? 0,
    status: d.status ?? "CONFIRMED",
    prepStatus: d.prepStatus ?? null,
    prepContainer: d.prepContainer ?? null,
    checkedOutAt: msToDate(d.checkedOutAt),
    checkedOutById: d.checkedOutById ?? null,
    returnedAt: msToDate(d.returnedAt),
    returnedById: d.returnedById ?? null,
    returnCondition: d.returnCondition ?? null,
    returnStatus: d.returnStatus ?? null,
    returnNotes: d.returnNotes ?? null,
    createdAt: msToDate(d.createdAt),
    updatedAt: msToDate(d.updatedAt),
  };
}

export interface MappedCategory {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function mapCategoryDoc(d: CategoryDoc): MappedCategory {
  return {
    id: d.id,
    organizationId: d.organizationId,
    projectId: d.projectId,
    name: d.name,
    sortOrder: d.sortOrder ?? 0,
    createdAt: msToDate(d.createdAt),
    updatedAt: msToDate(d.updatedAt),
  };
}

export interface MappedGroup {
  id: string;
  organizationId: string;
  projectId: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  quantity: number;
  price: number | null;
  suggestedPrice: number | null;
  rentalPeriod: string | null;
  rentalQuantity: number | null;
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function mapGroupDoc(d: GroupDoc): MappedGroup {
  return {
    id: d.id,
    organizationId: d.organizationId,
    projectId: d.projectId,
    categoryId: d.categoryId ?? null,
    title: d.title,
    description: d.description ?? null,
    quantity: d.quantity ?? 1,
    price: d.price ?? null,
    suggestedPrice: d.suggestedPrice ?? null,
    rentalPeriod: d.rentalPeriod ?? null,
    rentalQuantity: d.rentalQuantity ?? null,
    sortOrder: d.sortOrder ?? 0,
    createdAt: msToDate(d.createdAt),
    updatedAt: msToDate(d.updatedAt),
  };
}

/** A unit with its `asset` / `bulkAsset` resolved as `{ id, assetTag }` selects. */
type UnitWithAssetSelect = MappedUnit & {
  asset: { id: string; assetTag: string } | null;
  bulkAsset: { id: string; assetTag: string } | null;
};

/** Resolve a `{ id, assetTag }` select from a full Convex asset/bulk doc. */
function assetTagSelect(
  doc: { id: string; assetTag?: string | null } | undefined,
): { id: string; assetTag: string } | null {
  if (!doc) return null;
  return { id: doc.id, assetTag: doc.assetTag ?? "" };
}

/** A reconstructed line-item node carrying the relations getProject's Prisma
 *  include produced (plain kit — no `_count`). */
type AttachedNode = MappedLineItem & {
  units: UnitWithAssetSelect[];
  asset: ConvexAsset | null;
  bulkAsset: ConvexBulkAsset | null;
  kit: ConvexKit | null;
  model: unknown;
  supplier: unknown;
  childLineItems?: AttachedNode[];
};

/**
 * Attach raw-doc `asset` / `bulkAsset` / `kit` (full, Convex-meta stripped, dates
 * → `Date`) onto every node of a model/supplier-attached tree, recursing into
 * `childLineItems`. A null/missing id → `null`. Units are left untouched.
 */
export function attachAssetBulkKitPlain<
  T extends { assetId: string | null; bulkAssetId: string | null; kitId: string | null; childLineItems?: unknown },
>(
  rows: T[],
  assetMap: Map<string, ConvexAsset>,
  bulkAssetMap: Map<string, ConvexBulkAsset>,
  kitMap: Map<string, ConvexKit>,
): Array<T & { asset: ConvexAsset | null; bulkAsset: ConvexBulkAsset | null; kit: ConvexKit | null }> {
  return rows.map((row) => {
    const children = row.childLineItems;
    const assetDoc = row.assetId ? assetMap.get(row.assetId) : undefined;
    const bulkDoc = row.bulkAssetId ? bulkAssetMap.get(row.bulkAssetId) : undefined;
    const kitDoc = row.kitId ? kitMap.get(row.kitId) : undefined;
    return {
      ...row,
      asset: assetDoc ? (stripMetaWithDates(assetDoc, ASSET_DATE_KEYS) as ConvexAsset) : null,
      bulkAsset: bulkDoc ? (stripMetaWithDates(bulkDoc, BULK_ASSET_DATE_KEYS) as ConvexBulkAsset) : null,
      kit: kitDoc ? (stripMetaWithDates(kitDoc, KIT_DATE_KEYS) as ConvexKit) : null,
      ...(Array.isArray(children)
        ? { childLineItems: attachAssetBulkKitPlain(children as T[], assetMap, bulkAssetMap, kitMap) }
        : {}),
    };
  }) as Array<T & { asset: ConvexAsset | null; bulkAsset: ConvexBulkAsset | null; kit: ConvexKit | null }>;
}

export interface ProjectEquipmentTree {
  categories: Array<
    MappedCategory & {
      groups: Array<MappedGroup & { lineItems: AttachedNode[] }>;
      lineItems: AttachedNode[];
    }
  >;
  lineItems: AttachedNode[];
}

/** The raw-doc bundle `projectEquipment.browserBundle` (and `bundle`) returns. */
export type EquipmentBundleData = FunctionReturnType<typeof api.projectEquipment.browserBundle>;

/**
 * PURE reconstruction of getProject's equipment composition from the bundle's raw
 * docs — the `categories → groups → lineItems` grouped tree (childLineItems 1 deep)
 * and the top-level `lineItems` list (childLineItems 2 deep), with asset / bulkAsset
 * / kit / model / supplier attached and units carrying `{ id, assetTag }` selects.
 * Byte-for-byte the shape the server `buildProjectEquipmentTree` produced (it now
 * fetches the bundle and delegates here).
 */
export function reconstructProjectEquipmentTree(bundleData: EquipmentBundleData): ProjectEquipmentTree {
  const lineItems = bundleData.lineItems.map(mapLineItemDoc);
  const attachMaps: LineItemAttachMaps = {
    models: new Map(bundleData.models.map((m) => [m.id, m as unknown as ConvexModel])),
    suppliers: new Map(bundleData.suppliers.map((s) => [s.id, s as unknown as ConvexSupplier])),
    categories: new Map(bundleData.categories.map((c) => [c.id, c as unknown as ConvexCategory])),
  };

  const assetMap = new Map(bundleData.assets.map((a) => [a.id, a as unknown as ConvexAsset]));
  const bulkAssetMap = new Map(bundleData.bulkAssets.map((b) => [b.id, b as unknown as ConvexBulkAsset]));
  const kitMap = new Map(bundleData.kits.map((k) => [k.id, k as unknown as ConvexKit]));

  const units: UnitWithAssetSelect[] = bundleData.units.map((u) => {
    const m = mapUnitDoc(u);
    return {
      ...m,
      asset: m.assetId ? assetTagSelect(assetMap.get(m.assetId)) : null,
      bulkAsset: m.bulkAssetId ? assetTagSelect(bulkAssetMap.get(m.bulkAssetId)) : null,
    };
  });

  const byParent = indexChildren(lineItems);
  const unitsByLineItem = indexUnits(units);

  const rawCategories = reconstructCategories(
    bundleData.projectCategories.map(mapCategoryDoc),
    bundleData.groups.map(mapGroupDoc),
    lineItems,
    byParent,
    unitsByLineItem,
    1,
  );
  const rawTop = reconstructScope(lineItems, byParent, { unitsByLineItem, depth: 2 });

  const attach = (rows: ReturnType<typeof reconstructScope>) =>
    attachAssetBulkKitPlain(
      attachLineItemTree(rows, attachMaps) as never[],
      assetMap,
      bulkAssetMap,
      kitMap,
    ) as unknown as AttachedNode[];

  const categories = rawCategories.map((cat) => ({
    ...cat,
    groups: cat.groups.map((g) => ({ ...g, lineItems: attach(g.lineItems) })),
    lineItems: attach(cat.lineItems),
  }));
  const lineItemsOut = attach(rawTop);

  return { categories, lineItems: lineItemsOut };
}
