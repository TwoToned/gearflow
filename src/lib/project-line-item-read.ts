import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  type ConvexAsset,
  type ConvexBulkAsset,
  getAssetsByOrg,
  getBulkAssetsByOrg,
  getAssetsByIds,
  getBulkAssetsByIds,
} from "@/lib/assets-read";
import { type ConvexKit, getKitMap } from "@/lib/kits-read";
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
} from "@/lib/project-line-item-tree-read";
import { reconstructProjectEquipmentTree } from "@/lib/project-equipment-reconstruct";

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
 * **Shape fidelity (load-bearing):**
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

/** Convex's "field absent" (`undefined`) → the Prisma row shape's `null`. One
 *  helper rather than a `?? null` per field — the mapper below is a straight
 *  field-for-field projection, and the repeated null-coalescing was all this
 *  function's cyclomatic complexity (R-3.6). */
function orNull<T>(value: T | undefined | null): T | null {
  return value ?? null;
}

/** epoch-ms (Convex) → `Date`; absent/`null` → `null`. */
function msToDate(n: number | null | undefined): Date | null {
  return n == null ? null : new Date(n);
}

/**
 * A line item mapped from its Convex doc into the Prisma row shape getProject
 * expects (every scalar present, dates as `Date`, nullable absent → `null`).
 * Derived from `Doc<"projectLineItems">` (R-8.2.4) so a schema change is a
 * compile error here instead of a silently-stale duplicate.
 */
export type MappedLineItem = Omit<
  LineItemDoc,
  | "_id"
  | "_creationTime"
  | "type"
  | "modelId"
  | "assetId"
  | "bulkAssetId"
  | "kitId"
  | "isKitChild"
  | "childKind"
  | "parentLineItemId"
  | "pricingMode"
  | "description"
  | "quantity"
  | "unitPrice"
  | "pricingType"
  | "duration"
  | "discount"
  | "discountMode"
  | "lineTotal"
  | "priceBreakdown"
  | "priceOverridden"
  | "pricedUnderLock"
  | "overrideReason"
  | "sortOrder"
  | "groupName"
  | "categoryId"
  | "groupId"
  | "notes"
  | "isOptional"
  | "status"
  | "checkedOutQuantity"
  | "returnedQuantity"
  | "assignedQuantity"
  | "packedQuantity"
  | "damagedQuantity"
  | "lostQuantity"
  | "checkedOutAt"
  | "checkedOutById"
  | "returnedAt"
  | "returnedById"
  | "returnCondition"
  | "returnNotes"
  | "prepStatus"
  | "prepContainer"
  | "isContainerLineItem"
  | "isCustomItem"
  | "returnStatus"
  | "showSubhireOnDocs"
  | "supplierId"
  | "subhireOrderNumber"
  | "supplierOrderId"
  | "subHireId"
  | "subHireItemId"
  | "subHireGroupId"
  | "createdAt"
  | "updatedAt"
> & {
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
  /** #1012 — how `discount` was ENTERED. Null on every pre-#1012 row, which the
   *  document renderer reads as `"$"` (the pre-#1012 behaviour, no backfill). */
  discountMode: "$" | "%" | null;
  lineTotal: number | null;
  priceBreakdown: string | null;
  priceOverridden: boolean;
  /** True when `unitPrice`/`discount` were forced to $0/unset by `defaultToZero`
   *  (added or reset while the project was locked, no unlock session open) rather
   *  than a deliberate free line — the Unpriced badge's real signal. */
  pricedUnderLock: boolean;
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
};

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
    discountMode: d.discountMode ?? null,
    lineTotal: d.lineTotal ?? null,
    priceBreakdown: d.priceBreakdown ?? null,
    priceOverridden: d.priceOverridden ?? false,
    pricedUnderLock: d.pricedUnderLock ?? false,
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

/**
 * A unit mapped from its Convex doc (dates → `Date`). `asset` / `bulkAsset`
 * ({ id, assetTag }) are attached separately in {@link buildProjectEquipmentTree}.
 * Derived from `Doc<"projectLineItemUnits">` (R-8.2.4) so schema drift is a
 * compile error instead of a silently-stale duplicate.
 */
export type MappedUnit = Omit<
  UnitDoc,
  | "_id"
  | "_creationTime"
  | "assetId"
  | "bulkAssetId"
  | "parentUnitAssetId"
  | "quantity"
  | "returnedQuantity"
  | "status"
  | "prepStatus"
  | "prepContainer"
  | "checkedOutAt"
  | "checkedOutById"
  | "returnedAt"
  | "returnedById"
  | "returnCondition"
  | "returnStatus"
  | "returnNotes"
  | "createdAt"
  | "updatedAt"
> & {
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
};

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

/** Derived from `Doc<"projectCategories">` (R-8.2.4) so schema drift is a compile error. */
export type MappedCategory = Omit<CategoryDoc, "_id" | "_creationTime" | "sortOrder" | "createdAt" | "updatedAt"> & {
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

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

/** Derived from `Doc<"projectGroups">` (R-8.2.4) so schema drift is a compile error. */
export type MappedGroup = Omit<
  GroupDoc,
  | "_id"
  | "_creationTime"
  | "categoryId"
  | "description"
  | "quantity"
  | "price"
  | "discount"
  | "discountMode"
  | "suggestedPrice"
  | "sortOrder"
  | "pricedUnderLock"
  | "xeroAccountCode"
  | "xeroTaxType"
  | "createdAt"
  | "updatedAt"
> & {
  categoryId: string | null;
  description: string | null;
  quantity: number;
  price: number | null;
  discount: number | null;
  /** #1012 — how `discount` was ENTERED. Null = `"$"` (every pre-#1012 row). */
  discountMode: "$" | "%" | null;
  suggestedPrice: number | null;
  sortOrder: number;
  /** Mirrors `MappedLineItem.pricedUnderLock` — see that field's comment. */
  pricedUnderLock: boolean;
  xeroAccountCode: string | null;
  xeroTaxType: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export function mapGroupDoc(d: GroupDoc): MappedGroup {
  return {
    id: d.id,
    organizationId: d.organizationId,
    projectId: d.projectId,
    categoryId: orNull(d.categoryId),
    title: d.title,
    description: orNull(d.description),
    quantity: d.quantity ?? 1,
    price: orNull(d.price),
    discount: orNull(d.discount),
    discountMode: orNull(d.discountMode),
    suggestedPrice: orNull(d.suggestedPrice),
    sortOrder: d.sortOrder ?? 0,
    pricedUnderLock: d.pricedUnderLock ?? false,
    xeroAccountCode: orNull(d.xeroAccountCode),
    xeroTaxType: orNull(d.xeroTaxType),
    createdAt: msToDate(d.createdAt),
    updatedAt: msToDate(d.updatedAt),
  };
}

/** A unit with its `asset` / `bulkAsset` resolved as `{ id, assetTag }` selects. */
type UnitWithAssetSelect = MappedUnit & {
  asset: { id: string; assetTag: string } | null;
  bulkAsset: { id: string; assetTag: string } | null;
};

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
  // ONE round-trip: read line items + categories + groups + units + the referenced
  // assets/bulks/kits + the org's models/suppliers/categories, all inside a single
  // Convex query (backend-local reads). Was ~10 separate server→Convex queries in 3
  // sequential waves — the round-trip count was the latency, not the payload.
  // withConvexReadRetry: this bundle feeds the high-traffic project-detail page;
  // a transient blip must not take the whole page down (matches every other read domain).
  const bundleData = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.projectEquipment.bundle, { projectId, orgId: organizationId }),
  );

  // The reconstruction is PURE and now lives in the client-safe
  // project-equipment-reconstruct.ts (so the native read-layer cutover can run it
  // browser-side on a useQuery(browserBundle) result). Same code → parity. The
  // mappers below remain in this module for the OTHER reconstructions (warehouse /
  // pull-sheet) that still read here.
  return reconstructProjectEquipmentTree(bundleData);
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

  const [unitDocs, attachMaps, kitMap, modelCheckCounts, kitCheckCounts] =
    await Promise.all([
      lineItemIds.length
        ? convex.query(api.projectLineItemUnits.listByLineItemIds, { lineItemIds })
        : Promise.resolve([] as UnitDoc[]),
      buildLineItemAttachMaps(organizationId),
      getKitMap(organizationId),
      getModelCheckItemCountMap(organizationId),
      getKitCheckItemCountMap(organizationId),
    ]);

  // Scope asset/bulk reads to the ids this project's lines + units reference (assets
  // attach on BOTH lines and units here) — was getAssetsByOrg/getBulkAssetsByOrg (the
  // whole org registry) on every warehouse refetch.
  const refAssetIds = [...new Set(
    [...lineItems.map((li) => li.assetId), ...unitDocs.map((u) => u.assetId)]
      .filter((x): x is string => !!x),
  )];
  const refBulkIds = [...new Set(
    [...lineItems.map((li) => li.bulkAssetId), ...unitDocs.map((u) => u.bulkAssetId)]
      .filter((x): x is string => !!x),
  )];
  const [assetArr, bulkArr] = await Promise.all([
    getAssetsByIds(organizationId, refAssetIds),
    getBulkAssetsByIds(organizationId, refBulkIds),
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

/** Per-line `category` select the PDF builder's `lineItemInclude` produced. */
export interface DocCategorySelect {
  id: string;
  name: string;
  sortOrder: number;
}
/** Per-line `group` select the PDF builder's `lineItemInclude` produced. */
export interface DocGroupSelect {
  id: string;
  title: string;
  sortOrder: number;
  categoryId: string | null;
}

/** A `category` (with nested `groups`) for `structureLineItems`. */
export interface DocCategoryWithGroups {
  id: string;
  name: string;
  sortOrder: number;
  groups: MappedGroup[];
}

/**
 * Reconstruct the line-item tree + categories the PDF data builder
 * (`build-document-data.ts`) needs. Differs from the other consumers:
 * - **No `type` filter** — scope is ALL non-CANCELLED line items (parents AND
 *   children — dual projection), `childLineItems` 2 deep.
 * - Each line item (top + first child level, matching the Prisma include depth)
 *   carries a `category` `{id,name,sortOrder}` + `group` `{id,title,sortOrder,categoryId}`
 *   select, resolved from the Convex project category/group rows.
 * - Units are the PDF SELECT shape (`{id,status,parentUnitAssetId,assetId,bulkAssetId}`,
 *   ordinal-sorted) — `attachAssetBulkAssetTree` then adds full `asset`/`bulkAsset`.
 * - Attach pipeline: model/supplier → kit (+ `_count`) → asset/bulkAsset (no model
 *   check-count graft; the PDF doesn't use it).
 * Returns `{ lineItems, categories }` (categories = the cat+groups array for
 * `structureLineItems`).
 */
export async function buildDocumentLineItemData(projectId: string, organizationId: string) {
  const convex = await getConvexClient();
  const [liDocs, catDocs, grpDocs] = await Promise.all([
    convex.query(api.projectLineItems.listByProject, { projectId, orgId: organizationId }),
    convex.query(api.projectCategories.listByProject, { projectId, orgId: organizationId }),
    convex.query(api.projectGroups.listByProject, { projectId, orgId: organizationId }),
  ]);

  const lineItems = liDocs.map(mapLineItemDoc);
  const lineItemIds = lineItems.map((li) => li.id);
  const mappedCategories = catDocs.map(mapCategoryDoc);
  const mappedGroups = grpDocs.map(mapGroupDoc);

  const [unitDocs, attachMaps, kitMap, kitCountMap, assetArr, bulkArr] = await Promise.all([
    lineItemIds.length
      ? convex.query(api.projectLineItemUnits.listByLineItemIds, { lineItemIds })
      : Promise.resolve([] as UnitDoc[]),
    buildLineItemAttachMaps(organizationId),
    getKitMap(organizationId),
    getKitCheckItemCountMap(organizationId),
    getAssetsByOrg(organizationId),
    getBulkAssetsByOrg(organizationId),
  ]);

  const assetMap = new Map(assetArr.map((a) => [a.id, a]));
  const bulkAssetMap = new Map(bulkArr.map((b) => [b.id, b]));

  // Units in the PDF SELECT shape, ordinal-sorted (the Prisma include selects
  // exactly these fields, ordered by ordinal).
  const docUnits = unitDocs
    .map((u) => mapUnitDoc(u))
    .map((u) => ({
      id: u.id,
      status: u.status,
      parentUnitAssetId: u.parentUnitAssetId,
      assetId: u.assetId,
      bulkAssetId: u.bulkAssetId,
      // lineItemId + ordinal drive indexUnits (bucket + sort); harmless extras on output.
      lineItemId: u.lineItemId,
      ordinal: u.ordinal,
    }));
  const unitsByLineItem = indexUnits(docUnits);

  const byParent = indexChildren(lineItems); // default: drop CANCELLED
  const tree = reconstructScope(lineItems, byParent, { unitsByLineItem, depth: 2 });

  // Attach category/group selects at levels 0 + 1 (matching the include depth).
  const catSelect = new Map(mappedCategories.map((c) => [c.id, { id: c.id, name: c.name, sortOrder: c.sortOrder }]));
  const grpSelect = new Map(
    mappedGroups.map((g) => [g.id, { id: g.id, title: g.title, sortOrder: g.sortOrder, categoryId: g.categoryId }]),
  );
  const attachCatGroup = <
    T extends { categoryId: string | null; groupId: string | null; childLineItems?: unknown },
  >(
    rows: T[],
    level: number,
  ): T[] =>
    rows.map((row) => ({
      ...row,
      ...(level <= 1
        ? {
            category: row.categoryId ? catSelect.get(row.categoryId) ?? null : null,
            group: row.groupId ? grpSelect.get(row.groupId) ?? null : null,
          }
        : {}),
      ...(Array.isArray(row.childLineItems)
        ? { childLineItems: attachCatGroup(row.childLineItems as T[], level + 1) }
        : {}),
    })) as T[];
  const withCatGroup = attachCatGroup(tree, 0);

  const withModelSupplier = attachLineItemTree(withCatGroup, attachMaps);
  const withKits = attachKitTree(withModelSupplier, kitMap, kitCountMap);
  const withAssets = attachAssetBulkAssetTree(withKits, assetMap, bulkAssetMap);

  const categories: DocCategoryWithGroups[] = [...mappedCategories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      groups: mappedGroups
        .filter((g) => g.categoryId === c.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));

  // Groups the office hasn't (yet) filed under a real category — the
  // equipment tab's "Uncategorized" zone (`ProjectGroup.categoryId: null`)
  // is a first-class, fully-supported state there, not an error. Without
  // this, such a group is invisible to `structureLineItems` (it only reads
  // groups nested under a real category above): its own synthetic row never
  // renders, its members aren't recognized as excluded-from-flat-listing,
  // and the whole group prints as disconnected flat line items on quotes/
  // invoices instead of collapsing — see FEATUREDOCS/13-pdfs.md. `name:
  // "Uncategorized"` gives it a real section header (2026-07-28) — a blank
  // name used to bucket it under each doc's silent "no header" fallback,
  // which visually merged it into whatever category printed above it.
  const uncategorizedGroups = mappedGroups
    .filter((g) => !g.categoryId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (uncategorizedGroups.length > 0) {
    categories.push({
      id: "__uncategorized__",
      name: "Uncategorized",
      sortOrder: Number.MAX_SAFE_INTEGER,
      groups: uncategorizedGroups,
    });
  }

  return { lineItems: withAssets, categories };
}

export type { LineItemAttachMaps, ConvexLocation };
