import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  type ConvexAsset,
  type ConvexBulkAsset,
  getAssetsByOrg,
  getBulkAssetsByOrg,
} from "@/lib/assets-read";
import { type ConvexKit, getKitsByOrg, getKitMap } from "@/lib/kits-read";
import { type ConvexLocation, getLocationMap } from "@/lib/locations-read";
import {
  buildLineItemAttachMaps,
  attachLineItemTree,
  attachModelCheckItemCounts,
  attachKitTree,
  attachAssetBulkAssetTree,
  getModelCheckItemCountMap,
  getKitCheckItemCountMap,
  type LineItemAttachMaps,
} from "@/lib/line-item-tree-read";
import {
  indexChildren,
  indexUnits,
  reconstructScope,
  reconstructCategories,
} from "@/lib/project-line-item-tree-read";

/**
 * Convex read layer for the project **equipment line-item tree** — the I/O +
 * Convex-doc→Prisma-shape mapping that sits on top of the pure reconstruction
 * primitive in `project-line-item-tree-read.ts`. The keystone of the Phase A
 * read-rewiring: `getProject` (equipment editor) reconstructs its
 * `categories → groups → lineItems → childLineItems → units` tree from the flat
 * dual-written Convex tables here instead of a nested Prisma `include`.
 * (`getProjectForWarehouse` / `getProjectPullSheet` / `build-document-data`
 * follow in their own PRs, reusing these fetchers + mappers.)
 *
 * **Shape fidelity (load-bearing — see docs/designs/convex-domain-only-decommission.md):**
 * - The line-item ROW is mapped full-fidelity: every Prisma scalar present, date
 *   fields epoch-ms → `Date`, nullable fields absent → `null`, Convex `_id` /
 *   `_creationTime` stripped. `Decimal` columns are stored as `number` in Convex
 *   and `serialize()` collapses Prisma `Decimal` → `number` too, so money needs no
 *   conversion (both stores end up `number`).
 * - Nested `asset` / `bulkAsset` / `kit` are mapped from their Convex docs with
 *   date fields → `Date` and Convex meta stripped (the same fidelity model/supplier
 *   already get via `attachLineItemTree`). getProject uses a **plain** kit (no
 *   `_count` — that graft is warehouse-only).
 * - `units` carry `asset` / `bulkAsset` as `{ id, assetTag }` selects, matching
 *   getProject's `PROJECT_UNIT_INCLUDE`.
 *
 * **No Prisma fallback on a Convex miss** — a missing nested doc yields `null`,
 * same as a Prisma join against a deleted row (surfaces mirror drift instead of
 * hiding it).
 */

type LineItemDoc = Doc<"projectLineItems">;
type UnitDoc = Doc<"projectLineItemUnits">;
type CategoryDoc = Doc<"projectCategories">;
type GroupDoc = Doc<"projectGroups">;

/** epoch-ms (Convex) → `Date`; absent/`null` → `null`. */
function msToDate(n: number | null | undefined): Date | null {
  return n == null ? null : new Date(n);
}

/** Strip Convex meta + convert the listed epoch-ms keys to `Date` (absent → key
 *  preserved as-is). Used for nested asset/bulkAsset/kit, matching the raw-doc
 *  fidelity model/supplier already get. */
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

/** A unit mapped from its Convex doc (dates → `Date`). `asset` / `bulkAsset`
 *  ({ id, assetTag }) are attached separately in {@link buildProjectEquipmentTree}. */
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
  billingMonths: number | null;
  billingWeeks: number | null;
  billingDays: number | null;
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
    billingMonths: d.billingMonths ?? null,
    billingWeeks: d.billingWeeks ?? null,
    billingDays: d.billingDays ?? null,
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
 *  include produced (plain kit — no `_count`). `childLineItems` is present only
 *  to the included depth (absent past it). */
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
 * `childLineItems`. A null/missing id → `null` (no Prisma fallback). Units are
 * left untouched (already shaped in {@link buildProjectEquipmentTree}).
 */
function attachAssetBulkKitPlain<
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

/**
 * Reconstruct getProject's full equipment composition from Convex: the
 * `categories → groups → lineItems` grouped tree (childLineItems 1 deep) and the
 * top-level `lineItems` list (ALL non-CANCELLED items, childLineItems 2 deep),
 * with `asset` / `bulkAsset` / `kit` / `model` / `supplier` attached and units
 * carrying `{ id, assetTag }` selects — byte-for-byte the shape the old nested
 * Prisma `include` produced (modulo the model/supplier Convex-shape already shipped).
 */
export async function buildProjectEquipmentTree(
  projectId: string,
  organizationId: string,
): Promise<ProjectEquipmentTree> {
  const convex = await getConvexClient();
  const [liDocs, catDocs, grpDocs] = await Promise.all([
    convex.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId }),
    convex.query(api.projectCategories.listByProject, { projectId, orgId: organizationId }),
    convex.query(api.projectGroups.listByProject, { projectId, orgId: organizationId }),
  ]);

  const lineItems = liDocs.map(mapLineItemDoc);
  const lineItemIds = lineItems.map((li) => li.id);

  const [unitDocs, attachMaps, assetArr, bulkArr, kitArr] = await Promise.all([
    lineItemIds.length
      ? convex.query(api.projectLineItemUnits.listByLineItemIds, { lineItemIds })
      : Promise.resolve([] as UnitDoc[]),
    buildLineItemAttachMaps(organizationId),
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
    getKitsByOrg(organizationId),
  ]);

  const assetMap = new Map(assetArr.map((a) => [a.id, a]));
  const bulkAssetMap = new Map(bulkArr.map((b) => [b.id, b]));
  const kitMap = new Map(kitArr.map((k) => [k.id, k]));

  // Units carry `asset`/`bulkAsset` as `{ id, assetTag }` selects (PROJECT_UNIT_INCLUDE).
  const units: UnitWithAssetSelect[] = unitDocs.map((u) => {
    const m = mapUnitDoc(u);
    return {
      ...m,
      asset: m.assetId ? assetTagSelect(assetMap.get(m.assetId)) : null,
      bulkAsset: m.bulkAssetId ? assetTagSelect(bulkAssetMap.get(m.bulkAssetId)) : null,
    };
  });

  const byParent = indexChildren(lineItems);
  const unitsByLineItem = indexUnits(units);

  // Grouped tree: childLineItems 1 deep. Top-level list: ALL items, 2 deep.
  const rawCategories = reconstructCategories(
    catDocs.map(mapCategoryDoc),
    grpDocs.map(mapGroupDoc),
    lineItems,
    byParent,
    unitsByLineItem,
    1,
  );
  const rawTop = reconstructScope(lineItems, byParent, { unitsByLineItem, depth: 2 });

  // Attach pass 1: model + supplier (existing shared helper). Pass 2: asset/bulkAsset/kit.
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

/**
 * Reconstruct getProjectForWarehouse's line-item list from Convex. Unlike
 * getProject this is a FLAT list (no category/group grouping), scoped to
 * `type === "EQUIPMENT"`, and **keeps every status** (no CANCELLED filter on line
 * items / children — matching the warehouse Prisma include). Each line item AND
 * each unit gets the FULL `asset`/`bulkAsset` doc (`attachAssetBulkAssetTree`),
 * `model._count.modelCheckItems` + `kit._count.kitCheckItems` are grafted off the
 * Convex mirror, and `childLineItems` nest 2 deep. Units are non-CANCELLED only.
 */
export async function buildWarehouseLineItems(projectId: string, organizationId: string) {
  const convex = await getConvexClient();
  const liDocs = await convex.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const lineItems = liDocs.map(mapLineItemDoc);
  const lineItemIds = lineItems.map((li) => li.id);

  const [unitDocs, attachMaps, kitMap, modelCheckCounts, kitCheckCounts, assetArr, bulkArr] =
    await Promise.all([
      lineItemIds.length
        ? convex.query(api.projectLineItemUnits.listByLineItemIds, { lineItemIds })
        : Promise.resolve([] as UnitDoc[]),
      buildLineItemAttachMaps(organizationId),
      getKitMap(organizationId),
      getModelCheckItemCountMap(organizationId),
      getKitCheckItemCountMap(organizationId),
      getAssetsByOrg(organizationId),
      getBulkAssetsByOrg(organizationId),
    ]);

  const assetMap = new Map(assetArr.map((a) => [a.id, a]));
  const bulkAssetMap = new Map(bulkArr.map((b) => [b.id, b]));

  const units = unitDocs.map(mapUnitDoc);
  const unitsByLineItem = indexUnits(units);
  const byParent = indexChildren(lineItems, true); // keep CANCELLED children
  const scope = lineItems.filter((li) => li.type === "EQUIPMENT");
  const tree = reconstructScope(scope, byParent, {
    unitsByLineItem,
    depth: 2,
    keepCancelled: true,
  });

  // Same attach pipeline getProjectForWarehouse used inline: model/supplier →
  // model check-item count → kit (+ count) → asset/bulkAsset (full, on lines AND units).
  const withModelSupplier = attachLineItemTree(tree, attachMaps);
  const withModelCount = attachModelCheckItemCounts(withModelSupplier, modelCheckCounts);
  const withKits = attachKitTree(withModelCount, kitMap, kitCheckCounts);
  return attachAssetBulkAssetTree(withKits, assetMap, bulkAssetMap);
}

/**
 * Reconstruct getProjectPullSheet's line items from Convex. Like the warehouse
 * read it's a FLAT `type === "EQUIPMENT"` list with the full attach pipeline, but
 * (matching the pull-sheet Prisma include) it **drops CANCELLED** line items +
 * children, fetches **no units** (the pull sheet doesn't use them; the attach
 * pipeline still produces `units: []`), and grafts each asset's resolved
 * `location` object (`attachAssetBulkAssetTree` then a location graft —
 * shape-identical to the old `asset: { include: { location } }`). Returns the
 * grafted line items + the `locationMap` so the caller can resolve
 * `project.location` from the same round-trip.
 */
export async function buildPullSheetLineItems(projectId: string, organizationId: string) {
  const convex = await getConvexClient();
  const liDocs = await convex.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const lineItems = liDocs.map(mapLineItemDoc);

  const [attachMaps, kitMap, modelCheckCounts, kitCheckCounts, assetArr, bulkArr, locationMap] =
    await Promise.all([
      buildLineItemAttachMaps(organizationId),
      getKitMap(organizationId),
      getModelCheckItemCountMap(organizationId),
      getKitCheckItemCountMap(organizationId),
      getAssetsByOrg(organizationId),
      getBulkAssetsByOrg(organizationId),
      getLocationMap(organizationId),
    ]);

  const assetMap = new Map(assetArr.map((a) => [a.id, a]));
  const bulkAssetMap = new Map(bulkArr.map((b) => [b.id, b]));

  // No units on the pull sheet; CANCELLED line items + children dropped (default).
  const byParent = indexChildren(lineItems);
  const scope = lineItems.filter((li) => li.type === "EQUIPMENT");
  const tree = reconstructScope(scope, byParent, {
    unitsByLineItem: new Map<string, MappedUnit[]>(),
    depth: 2,
  });

  const withModelSupplier = attachLineItemTree(tree, attachMaps);
  const withModelCount = attachModelCheckItemCounts(withModelSupplier, modelCheckCounts);
  const withKits = attachKitTree(withModelCount, kitMap, kitCheckCounts);
  const withAssets = attachAssetBulkAssetTree(withKits, assetMap, bulkAssetMap);

  // Graft the resolved location object onto each asset (and recurse children),
  // matching the old `asset: { include: { location } }` join.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graftAssetLocation = (items: any[]): any[] =>
    items.map((li) => ({
      ...li,
      asset: li.asset
        ? { ...li.asset, location: li.asset.locationId ? locationMap.get(li.asset.locationId) ?? null : null }
        : li.asset,
      childLineItems: li.childLineItems ? graftAssetLocation(li.childLineItems) : li.childLineItems,
    }));

  return { lineItems: graftAssetLocation(withAssets), locationMap };
}

export type { LineItemAttachMaps, ConvexLocation };
