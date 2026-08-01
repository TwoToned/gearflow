/**
 * CLIENT-SAFE reconstruction of the project EQUIPMENT EDITING TAB's six
 * server-action reads from the ONE `equipmentTab.bundle` subscription (+
 * `overbooking.bundle` for the overbooked view). Zero server imports.
 *
 * The six views, reproduced byte-for-byte from the server actions they replace
 * (parity-by-construction — these are direct ports with the same composition):
 *   1. reconstructProjectCategories   ← getProjectCategories
 *   2. reconstructUncategorizedLineItems ← getUncategorizedLineItems
 *   3. reconstructUncategorizedSubHireGroups ← getUncategorizedSubHireGroups
 *   4. reconstructUncategorizedProjectGroups ← getUncategorizedProjectGroups
 *   5. reconstructOverbookedRecord     ← getProjectOverbookedStatus
 *   6. reconstructProjectSubHires      ← getSubHires({ projectId }) — equipment-tab
 *      slice only (summary + draft detection; SubHireExpandedItems fetches its own).
 *
 * Reuses the pure line-item attach/tree helpers from project-equipment-reconstruct
 * and project-line-item-tree-read. The sub-hire mappers are COPIES of the pure ones
 * in sub-hire-read.ts (which keeps server-only co-residents) — keep them in sync.
 */
import type { FunctionReturnType } from "convex/server";
import type { Doc } from "../../convex/_generated/dataModel";
import type { api } from "../../convex/_generated/api";
import type {
  SubHireStatus,
  SubHirePricingMode,
  SubHirePaymentStatus,
  PricingType,
} from "@/generated/prisma/client";
import type { ConvexAsset, ConvexBulkAsset } from "@/lib/assets-read";
import type { ConvexKit } from "@/lib/kits-read";
import type { ConvexModel } from "@/lib/models-read";
import type { ConvexSupplier } from "@/lib/suppliers-read";
import type { ConvexCategory } from "@/lib/categories-read";
import type {
  CategoryData,
  GroupData,
  SubHireGroupData,
  LineItemData,
  MixedGroupSlot,
} from "@/components/projects/equipment-rows";
import {
  mapLineItemDoc,
  mapUnitDoc,
  mapCategoryDoc,
  mapGroupDoc,
  attachLineItemTree,
  attachAssetBulkKitPlain,
  assetTagSelect,
  resolveAttachedSupplier,
  type LineItemAttachMaps,
  type MappedLineItem,
  type UnitWithAssetSelect,
} from "@/lib/project-equipment-reconstruct";
import { indexChildren, indexUnits, reconstructScope } from "@/lib/project-line-item-tree-read";
import {
  reconstructOverbookedStatus,
  type OverbookedInfo,
  type OverbookingBundleData,
} from "@/lib/overbooking-core";

/** The raw-doc bundle `equipmentTab.bundle` returns. */
export type EquipmentTabBundleData = FunctionReturnType<typeof api.equipmentTab.bundle>;

// ─── Sub-hire mappers (copies of sub-hire-read.ts pure mappers) ──────────────

type RawSubHire = Doc<"subHires">;
type RawItem = Doc<"subHireItems">;
type RawGroup = Doc<"subHireGroups">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;

interface SubHireRow {
  id: string;
  organizationId: string;
  supplierId: string;
  projectId: string | null;
  createdById: string;
  orderNumber: string;
  supplierReference: string | null;
  status: SubHireStatus;
  hireStart: Date | null;
  hireEnd: Date | null;
  totalCost: number;
  totalCharge: number;
  pricingMode: SubHirePricingMode;
  orderTotalCost: number | null;
  orderTotalCharge: number | null;
  showOnDocs: boolean;
  paymentStatus: SubHirePaymentStatus;
  notes: string | null;
  defaultTargetCategoryId: string | null;
  defaultTargetGroupId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface SubHireItemRow {
  id: string;
  subHireId: string;
  groupId: string | null;
  modelId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  unitCharge: number;
  pricingType: PricingType;
  duration: number;
  discount: number;
  showOnQuote: boolean;
  showOnDocs: boolean;
  sortOrder: number;
  targetCategoryId: string | null;
  targetGroupId: string | null;
  notes: string | null;
}

interface SubHireGroupRow {
  id: string;
  subHireId: string;
  title: string;
  sortOrder: number;
  quantity: number;
  cost: number | null;
  charge: number | null;
  showOnQuote: boolean;
  showOnDocs: boolean;
  targetCategoryId: string | null;
  targetGroupId: string | null;
}

function mapSubHire(d: RawSubHire): SubHireRow {
  return {
    id: d.id,
    organizationId: req(d.organizationId),
    supplierId: req(d.supplierId),
    projectId: orNull(d.projectId),
    createdById: req(d.createdById),
    orderNumber: req(d.orderNumber),
    supplierReference: orNull(d.supplierReference),
    status: (d.status ?? "DRAFT") as SubHireStatus,
    hireStart: toDate(d.hireStart),
    hireEnd: toDate(d.hireEnd),
    totalCost: d.totalCost ?? 0,
    totalCharge: d.totalCharge ?? 0,
    pricingMode: (d.pricingMode ?? "ITEMIZED") as SubHirePricingMode,
    orderTotalCost: orNull(d.orderTotalCost),
    orderTotalCharge: orNull(d.orderTotalCharge),
    showOnDocs: d.showOnDocs ?? false,
    paymentStatus: (d.paymentStatus ?? "UNPAID") as SubHirePaymentStatus,
    notes: orNull(d.notes),
    defaultTargetCategoryId: orNull(d.defaultTargetCategoryId),
    defaultTargetGroupId: orNull(d.defaultTargetGroupId),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

function mapSubHireItem(d: RawItem): SubHireItemRow {
  return {
    id: d.id,
    subHireId: req(d.subHireId),
    groupId: orNull(d.groupId),
    modelId: orNull(d.modelId),
    description: req(d.description),
    quantity: d.quantity ?? 1,
    unitCost: d.unitCost ?? 0,
    unitCharge: d.unitCharge ?? 0,
    pricingType: (d.pricingType ?? "FLAT") as PricingType,
    duration: d.duration ?? 1,
    discount: d.discount ?? 0,
    showOnQuote: d.showOnQuote ?? true,
    showOnDocs: d.showOnDocs ?? false,
    sortOrder: d.sortOrder ?? 0,
    targetCategoryId: orNull(d.targetCategoryId),
    targetGroupId: orNull(d.targetGroupId),
    notes: orNull(d.notes),
  };
}

function mapSubHireGroup(d: RawGroup): SubHireGroupRow {
  return {
    id: d.id,
    subHireId: req(d.subHireId),
    title: req(d.title),
    sortOrder: d.sortOrder ?? 0,
    quantity: d.quantity ?? 1,
    cost: orNull(d.cost),
    charge: orNull(d.charge),
    showOnQuote: d.showOnQuote ?? true,
    showOnDocs: d.showOnDocs ?? false,
    targetCategoryId: orNull(d.targetCategoryId),
    targetGroupId: orNull(d.targetGroupId),
  };
}

// ─── Shared attach context (one per bundle) ──────────────────────────────────

interface EquipmentContext {
  mappedLineItems: MappedLineItem[];
  byParent: Map<string, MappedLineItem[]>;
  unitsByLineItem: Map<string, UnitWithAssetSelect[]>;
  attachMaps: LineItemAttachMaps;
  assetMap: Map<string, ConvexAsset>;
  bulkAssetMap: Map<string, ConvexBulkAsset>;
  kitMap: Map<string, ConvexKit>;
}

function buildContext(bundle: EquipmentTabBundleData): EquipmentContext {
  const mappedLineItems = bundle.lineItems.map(mapLineItemDoc);
  const assetMap = new Map(bundle.assets.map((a) => [a.id, a as unknown as ConvexAsset]));
  const bulkAssetMap = new Map(bundle.bulkAssets.map((b) => [b.id, b as unknown as ConvexBulkAsset]));

  // Resolve each fulfillment unit's asset/bulk tag select the same way
  // reconstructProjectEquipmentTree does, then index by lineItemId. `expand()`
  // attaches these to every line AND recurses into kit/accessory children, so a
  // multi-qty serialised line expands into per-unit tags and kit-member serials
  // surface too. Kit members now carry their serial on their own per-unit row
  // (like loose gear) — the render layer shows tag + fulfillment status from it.
  const units: UnitWithAssetSelect[] = bundle.units.map((u) => {
    const m = mapUnitDoc(u);
    return {
      ...m,
      asset: m.assetId ? assetTagSelect(assetMap.get(m.assetId)) : null,
      bulkAsset: m.bulkAssetId ? assetTagSelect(bulkAssetMap.get(m.bulkAssetId)) : null,
    };
  });

  return {
    mappedLineItems,
    byParent: indexChildren(mappedLineItems),
    unitsByLineItem: indexUnits(units),
    attachMaps: {
      models: new Map(bundle.models.map((m) => [m.id, m as unknown as ConvexModel])),
      suppliers: new Map(bundle.suppliers.map((s) => [s.id, s as unknown as ConvexSupplier])),
      categories: new Map(bundle.orgCategories.map((c) => [c.id, c as unknown as ConvexCategory])),
    },
    assetMap,
    bulkAssetMap,
    kitMap: new Map(bundle.kits.map((k) => [k.id, k as unknown as ConvexKit])),
  };
}

/**
 * Reconstruct (childLineItems depth 1, WITH per-unit fulfillment rows) + fully
 * attach a scope of mapped line items. Units carry `{ id, assetTag }` asset selects
 * so the equipment tab can show which specific serial is prepped/deployed/returned
 * on each line (see project-equipment-reconstruct's reconstructProjectEquipmentTree,
 * the getProject/pull-sheet equivalent). Previously passed an empty unit map.
 */
function attachScope(scopeRows: MappedLineItem[], ctx: EquipmentContext): LineItemData[] {
  const reconstructed = reconstructScope(scopeRows, ctx.byParent, {
    unitsByLineItem: ctx.unitsByLineItem,
    depth: 1,
  });
  const withModelSupplier = attachLineItemTree(reconstructed, ctx.attachMaps);
  return attachAssetBulkKitPlain(
    withModelSupplier as never[],
    ctx.assetMap,
    ctx.bulkAssetMap,
    ctx.kitMap,
  ) as unknown as LineItemData[];
}

// ─── View 1: getProjectCategories ────────────────────────────────────────────

/** SubHireGroupData (categorized or not) from a mapped group + its sub-hire/items. */
function buildSubHireGroupData(
  g: SubHireGroupRow,
  subHireById: Map<string, SubHireRow>,
  itemsByGroupId: Map<string, SubHireItemRow[]>,
  lineItemsBySubHireGroupId: Map<string, MappedLineItem[]>,
  ctx: EquipmentContext,
): SubHireGroupData {
  const subHire = subHireById.get(g.subHireId)!;
  return {
    id: g.id,
    title: g.title,
    quantity: g.quantity,
    cost: g.cost,
    charge: g.charge,
    sortOrder: g.sortOrder,
    targetCategoryId: g.targetCategoryId,
    showOnQuote: g.showOnQuote,
    showOnDocs: g.showOnDocs,
    subHire: {
      id: subHire.id,
      orderNumber: subHire.orderNumber,
      status: subHire.status,
      supplier: resolveAttachedSupplier(subHire.supplierId, ctx.attachMaps),
    },
    items: itemsByGroupId.get(g.id) ?? [],
    lineItems: attachScope(lineItemsBySubHireGroupId.get(g.id) ?? [], ctx),
  };
}

/** GroupData (project group) from a mapped group + its line items. */
function buildGroupData(
  g: ReturnType<typeof mapGroupDoc>,
  lineItemsByGroupId: Map<string, MappedLineItem[]>,
  ctx: EquipmentContext,
): GroupData {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    quantity: g.quantity,
    price: g.price,
    discount: g.discount,
    suggestedPrice: g.suggestedPrice,
    sortOrder: g.sortOrder,
    pricedUnderLock: g.pricedUnderLock,
    lineItems: attachScope(lineItemsByGroupId.get(g.id) ?? [], ctx),
  };
}

export function reconstructProjectCategories(bundle: EquipmentTabBundleData): CategoryData[] {
  const ctx = buildContext(bundle);
  const { mappedLineItems } = ctx;

  // Category slots → sortOrder lookups (for the mixedGroups ordering).
  const slotByGroupId = new Map(
    bundle.categorySlots.filter((s) => s.projectGroupId).map((s) => [s.projectGroupId!, s]),
  );
  const slotBySubHireGroupId = new Map(
    bundle.categorySlots.filter((s) => s.subHireGroupId).map((s) => [s.subHireGroupId!, s]),
  );
  const slotByLineItemId = new Map(
    bundle.categorySlots.filter((s) => s.lineItemId).map((s) => [s.lineItemId!, s]),
  );
  // A standalone line item with no real CategorySlot yet (never explicitly
  // reordered against a group) falls back to this offset + its own sortOrder
  // — reliably bigger than any real slot's sortOrder (those are small
  // per-category ints minted 0, 1, 2… by the reorder mutation), so an
  // unslotted line item always renders AFTER every slotted group, matching
  // today's "groups first, then standalone items" convention until a user
  // actually drags one into a new combined position.
  const LINE_ITEM_FALLBACK_OFFSET = 1_000_000;

  // Sub-hire groups (categorized) + their items, keyed for assembly.
  const subHireById = new Map(bundle.subHires.map((s) => [s.id, mapSubHire(s)]));
  const subHireItems = bundle.subHireItems.map(mapSubHireItem);
  const itemsByGroupId = new Map<string, SubHireItemRow[]>();
  for (const it of subHireItems) {
    if (!it.groupId) continue;
    const arr = itemsByGroupId.get(it.groupId) ?? [];
    arr.push(it);
    itemsByGroupId.set(it.groupId, arr);
  }
  const categorizedSHGroups = bundle.subHireGroups
    .map(mapSubHireGroup)
    .filter((g) => g.targetCategoryId != null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const shGroupIdSet = new Set(categorizedSHGroups.map((g) => g.id));

  // Top-level line items keyed by their grouping. Mirror getProjectCategories'
  // TWO INDEPENDENT passes (not one mutually-exclusive chain): a synthetic
  // sub-hire-group parent line carries BOTH a subHireGroupId and a categoryId, so
  // the server lands it in subHireGroupLineItems AND lineItemsByCatId. Pass 2 keys
  // by groupId-else-categoryId without consulting subHireGroupId, exactly like
  // src/server/project-categories.ts:186-195 + 222-235.
  const lineItemsBySubHireGroupId = new Map<string, MappedLineItem[]>();
  const lineItemsByGroupId = new Map<string, MappedLineItem[]>();
  const lineItemsByCatId = new Map<string, MappedLineItem[]>();
  for (const li of mappedLineItems) {
    if (li.isKitChild || li.parentLineItemId) continue;
    if (li.subHireGroupId && shGroupIdSet.has(li.subHireGroupId)) {
      const arr = lineItemsBySubHireGroupId.get(li.subHireGroupId) ?? [];
      arr.push(li);
      lineItemsBySubHireGroupId.set(li.subHireGroupId, arr);
    }
  }
  for (const li of mappedLineItems) {
    if (li.isKitChild || li.parentLineItemId) continue;
    if (li.groupId) {
      const arr = lineItemsByGroupId.get(li.groupId) ?? [];
      arr.push(li);
      lineItemsByGroupId.set(li.groupId, arr);
    } else if (li.categoryId) {
      const arr = lineItemsByCatId.get(li.categoryId) ?? [];
      arr.push(li);
      lineItemsByCatId.set(li.categoryId, arr);
    }
  }

  // Project groups + sub-hire groups grouped by category.
  const groupsByCategoryId = new Map<string, ReturnType<typeof mapGroupDoc>[]>();
  for (const g of bundle.groups.map(mapGroupDoc)) {
    if (!g.categoryId) continue;
    const arr = groupsByCategoryId.get(g.categoryId) ?? [];
    arr.push(g);
    groupsByCategoryId.set(g.categoryId, arr);
  }
  const subHireGroupsByCategory = new Map<string, SubHireGroupRow[]>();
  for (const sg of categorizedSHGroups) {
    if (!sg.targetCategoryId) continue;
    const arr = subHireGroupsByCategory.get(sg.targetCategoryId) ?? [];
    arr.push(sg);
    subHireGroupsByCategory.set(sg.targetCategoryId, arr);
  }

  return bundle.categories
    .map(mapCategoryDoc)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((cat) => {
      const catGroups = (groupsByCategoryId.get(cat.id) ?? [])
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((g) => buildGroupData(g, lineItemsByGroupId, ctx));

      const catSubHireGroups = (subHireGroupsByCategory.get(cat.id) ?? []).map((sg) =>
        buildSubHireGroupData(sg, subHireById, itemsByGroupId, lineItemsBySubHireGroupId, ctx),
      );

      const catStandaloneLineItems = lineItemsByCatId.get(cat.id) ?? [];

      const mixedGroups: MixedGroupSlot[] = [
        ...catGroups.map((g) => ({
          kind: "project" as const,
          sortOrder: slotByGroupId.get(g.id)?.sortOrder ?? g.sortOrder ?? 0,
          projectGroupId: g.id,
        })),
        ...catSubHireGroups.map((sg) => ({
          kind: "subHire" as const,
          sortOrder: slotBySubHireGroupId.get(sg.id)?.sortOrder ?? sg.sortOrder ?? 0,
          subHireGroupId: sg.id,
        })),
        ...catStandaloneLineItems.map((li) => ({
          kind: "lineItem" as const,
          sortOrder: slotByLineItemId.get(li.id)?.sortOrder ?? LINE_ITEM_FALLBACK_OFFSET + (li.sortOrder ?? 0),
          lineItemId: li.id,
        })),
      ].sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        id: cat.id,
        name: cat.name,
        sortOrder: cat.sortOrder,
        groups: catGroups,
        subHireGroupTargets: catSubHireGroups,
        lineItems: attachScope(catStandaloneLineItems, ctx),
        mixedGroups,
      };
    });
}

// ─── View 2: getUncategorizedLineItems ───────────────────────────────────────

export function reconstructUncategorizedLineItems(bundle: EquipmentTabBundleData): LineItemData[] {
  const ctx = buildContext(bundle);
  const scope = ctx.mappedLineItems.filter(
    (li) => !li.isKitChild && !li.parentLineItemId && li.categoryId == null && li.groupId == null,
  );
  return attachScope(scope, ctx);
}

// ─── View 3: getUncategorizedSubHireGroups ───────────────────────────────────

export function reconstructUncategorizedSubHireGroups(
  bundle: EquipmentTabBundleData,
): SubHireGroupData[] {
  const ctx = buildContext(bundle);
  const groups = bundle.subHireGroups
    .map(mapSubHireGroup)
    .filter((g) => g.targetCategoryId == null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (groups.length === 0) return [];

  const subHireById = new Map(bundle.subHires.map((s) => [s.id, mapSubHire(s)]));
  const itemsByGroupId = new Map<string, SubHireItemRow[]>();
  for (const it of bundle.subHireItems.map(mapSubHireItem)) {
    if (!it.groupId) continue;
    const arr = itemsByGroupId.get(it.groupId) ?? [];
    arr.push(it);
    itemsByGroupId.set(it.groupId, arr);
  }
  const groupIdSet = new Set(groups.map((g) => g.id));
  const lineItemsBySubHireGroupId = new Map<string, MappedLineItem[]>();
  for (const li of ctx.mappedLineItems) {
    if (li.isKitChild || li.parentLineItemId) continue;
    if (li.subHireGroupId && groupIdSet.has(li.subHireGroupId)) {
      const arr = lineItemsBySubHireGroupId.get(li.subHireGroupId) ?? [];
      arr.push(li);
      lineItemsBySubHireGroupId.set(li.subHireGroupId, arr);
    }
  }
  return groups.map((g) =>
    buildSubHireGroupData(g, subHireById, itemsByGroupId, lineItemsBySubHireGroupId, ctx),
  );
}

// ─── View 4: getUncategorizedProjectGroups ───────────────────────────────────

export function reconstructUncategorizedProjectGroups(bundle: EquipmentTabBundleData): GroupData[] {
  const ctx = buildContext(bundle);
  const uncategorized = bundle.groups
    .map(mapGroupDoc)
    .filter((g) => !g.categoryId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (uncategorized.length === 0) return [];

  const groupIdSet = new Set(uncategorized.map((g) => g.id));
  const lineItemsByGroupId = new Map<string, MappedLineItem[]>();
  for (const li of ctx.mappedLineItems) {
    if (li.isKitChild || li.parentLineItemId) continue;
    if (li.groupId && groupIdSet.has(li.groupId)) {
      const arr = lineItemsByGroupId.get(li.groupId) ?? [];
      arr.push(li);
      lineItemsByGroupId.set(li.groupId, arr);
    }
  }
  return uncategorized.map((g) => buildGroupData(g, lineItemsByGroupId, ctx));
}

// ─── View 5: getProjectOverbookedStatus ──────────────────────────────────────

/**
 * `lineItemId → OverbookedInfo` record. Mirrors getProjectOverbookedStatus: the
 * FLAT non-cancelled mapped line items are passed to reconstructOverbookedStatus
 * (kit children included flat — different from getProject, which passes the nested
 * tree). `null` project window / dates → still computed (dateless = this-project
 * only). Returns `{}` when no overbooking bundle yet.
 */
export function reconstructOverbookedRecord(
  bundle: EquipmentTabBundleData,
  overbooking: OverbookingBundleData | undefined,
  rentalStartDate: Date | null,
  rentalEndDate: Date | null,
  projectId: string,
): Record<string, OverbookedInfo> {
  if (!overbooking) return {};
  const lineItems = bundle.lineItems.map(mapLineItemDoc).filter((li) => li.status !== "CANCELLED");
  const map = reconstructOverbookedStatus(overbooking, lineItems, rentalStartDate, rentalEndDate, projectId);
  return Object.fromEntries(map);
}

// ─── View 6: getSubHires({ projectId }) — equipment-tab slice ─────────────────

/** The sub-hire summary fields the equipment-tab consumes (+ _count + supplier). */
export type ProjectSubHireSummary = SubHireRow & {
  _count: { items: number };
  supplier: ConvexSupplier | null;
};

export function reconstructProjectSubHires(bundle: EquipmentTabBundleData): ProjectSubHireSummary[] {
  const ctx = buildContext(bundle);
  const itemCounts = new Map<string, number>();
  for (const it of bundle.subHireItems) {
    itemCounts.set(it.subHireId, (itemCounts.get(it.subHireId) ?? 0) + 1);
  }
  return bundle.subHires
    .map(mapSubHire)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .map((sh) => ({
      ...sh,
      _count: { items: itemCounts.get(sh.id) ?? 0 },
      supplier: resolveAttachedSupplier(sh.supplierId, ctx.attachMaps),
    }));
}
