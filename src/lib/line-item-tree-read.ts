import { getModelsByOrg, type ConvexModel } from "@/lib/models-read";
import { getSuppliersByOrg, type ConvexSupplier } from "@/lib/suppliers-read";
import { getCategoriesByOrg, type ConvexCategory } from "@/lib/categories-read";
import { type ConvexKit } from "@/lib/kits-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Recursive line-item-tree attach helper for the Prisma→Convex decommission
 * (Phase 6). Replaces the cross-domain `include: { model: { include: { category } },
 * supplier: { select: { name } } }` joins that hang off a project's
 * `lineItems → childLineItems` tree with a JS attach of the dual-write-fresh
 * Convex docs.
 *
 * Both `model` and `supplier` move together (one tree, one helper) so a tree is
 * never half-converted. The Prisma query that produces the rows KEEPS its
 * physical-asset joins (`asset` / `bulkAsset` / `kit` / `units`) and the
 * project-grouping joins (`category` = project_category, `group` = project_group)
 * — those are separate decommission dimensions. Only the `model` and `supplier`
 * relations are dropped from the include and re-attached here.
 *
 * **Two distinct "category" concepts** live on the same node and must not be
 * conflated: the line item's own `category` (a project_category relation, stays
 * Prisma this session) vs. the equipment `model.category` attached here from the
 * Convex `categories` table. They are different fields on different objects.
 *
 * **No Prisma fallback on a map miss.** Convex mirror freshness is the hard
 * invariant for every dual-written domain; a miss yields `null` (same as a Prisma
 * join against a deleted row). Falling back to Prisma would silently hide mirror
 * drift and re-introduce the very join we're removing. See FEATUREDOCS/54
 * "Phase 6 — Decommission".
 *
 * `*_media` cross-domain joins are NOT served here — those tables are not
 * dual-written to Convex yet, so any read of them stays on Prisma. The check-item
 * ASSIGNMENT tables (`model_check_item` / `kit_check_item`) ARE now dual-written,
 * so the warehouse `model._count.modelCheckItems` / `kit._count.kitCheckItems`
 * counts come off the Convex mirror via the count-map helpers + `attachKitTree`
 * below (no more Prisma `groupBy`).
 */

/** A Convex model doc with its equipment category resolved (replaces the Prisma
 * `model: { include: { category } }` join). */
export type AttachedModel = ConvexModel & { category: ConvexCategory | null };

export interface LineItemAttachMaps {
  models: Map<string, ConvexModel>;
  suppliers: Map<string, ConvexSupplier>;
  categories: Map<string, ConvexCategory>;
}

/**
 * Build the three org-scoped lookup maps the tree attach needs, in one
 * `Promise.all` round-trip. Reuse a single maps object across every tree in a
 * request (line items, sub-hire group line items, etc.) so an org's models /
 * suppliers / categories are fetched once.
 */
export async function buildLineItemAttachMaps(orgId: string): Promise<LineItemAttachMaps> {
  const [models, suppliers, categories] = await Promise.all([
    getModelsByOrg(orgId),
    getSuppliersByOrg(orgId),
    getCategoriesByOrg(orgId),
  ]);
  return {
    models: new Map(models.map((m) => [m.id, m])),
    suppliers: new Map(suppliers.map((s) => [s.id, s])),
    categories: new Map(categories.map((c) => [c.id, c])),
  };
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

/** Output node: the input row with `model` / `supplier` replaced by Convex docs.
 * `childLineItems` carries the recursively-attached subtree at runtime; it stays
 * typed as the input's shape because every downstream consumer reads it loosely
 * (the reads serialize the result or cast to a plugin type). */
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

// ---------------------------------------------------------------------------
// Check-item count graft (warehouse-only)
// ---------------------------------------------------------------------------
//
// The warehouse-prep reads (getProjectForWarehouse / getProjectPullSheet) gate
// per-line check prompts on `model._count.modelCheckItems` (8+ UI sites) and
// `kit._count.kitCheckItems`. Both junction tables (`model_check_item` /
// `kit_check_item`) are now dual-written to Convex, so the counts come off the
// mirror: one org-scoped Convex `list` per table, counted in JS into a Map, then
// grafted back onto the Convex-attached `model` / `kit` node — preserving the
// exact `_count: { … }` shape the old Prisma include produced. Everything else on
// the model (scalars, category, supplier) comes off the mirror via
// attachLineItemTree above; the kit comes off the mirror via attachKitTree below.

/**
 * Count of `model_check_item` rows per `modelId` for an org, sourced from the
 * Convex mirror (one org-scoped `list`, counted in JS). Replaces the old Prisma
 * `groupBy`. Feeds {@link attachModelCheckItemCounts}.
 */
export async function getModelCheckItemCountMap(orgId: string): Promise<Map<string, number>> {
  const rows = await (await getConvexClient()).query(api.modelCheckItems.list, { orgId });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.modelId, (map.get(r.modelId) ?? 0) + 1);
  return map;
}

/**
 * Count of `kit_check_item` rows per `kitId` for an org, sourced from the Convex
 * mirror. Feeds the `_count.kitCheckItems` graft in {@link attachKitTree}.
 */
export async function getKitCheckItemCountMap(orgId: string): Promise<Map<string, number>> {
  const rows = await (await getConvexClient()).query(api.kitCheckItems.list, { orgId });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.kitId, (map.get(r.kitId) ?? 0) + 1);
  return map;
}

/** A Convex-attached model node with the Prisma-sourced check-item count grafted
 * back on, matching the old `model: { _count: { modelCheckItems } }` include. */
export type ModelWithCheckCount = AttachedModel & {
  _count: { modelCheckItems: number };
};

/**
 * Collect every distinct `modelId` referenced anywhere in a line-item tree
 * (recursing into `childLineItems`). Use this to scope the single
 * `prisma.modelCheckItem.groupBy` that feeds {@link attachModelCheckItemCounts}.
 */
export function collectTreeModelIds<T extends LineItemNode>(rows: T[]): string[] {
  const ids = new Set<string>();
  const walk = (nodes: LineItemNode[]) => {
    for (const node of nodes) {
      if (node.modelId) ids.add(node.modelId);
      if (Array.isArray(node.childLineItems)) walk(node.childLineItems as LineItemNode[]);
    }
  };
  walk(rows);
  return [...ids];
}

/** A tree node that already has `model` attached (output of attachLineItemTree). */
type AttachedNode = { model: AttachedModel | null; childLineItems?: unknown };

/**
 * Graft `_count.modelCheckItems` onto every Convex-attached `model` node in a
 * line-item tree, sourcing the count from `countByModelId` (built once per
 * request by the caller via `prisma.modelCheckItem.groupBy`). A model absent from
 * the map gets `0`; a null model stays null. Returns new nodes; input is not
 * mutated. Run AFTER {@link attachLineItemTree}.
 */
export function attachModelCheckItemCounts<T extends AttachedNode>(
  rows: T[],
  countByModelId: Map<string, number>,
): Array<Omit<T, "model"> & { model: ModelWithCheckCount | null }> {
  return rows.map((row) => {
    const children = row.childLineItems;
    const model: ModelWithCheckCount | null = row.model
      ? { ...row.model, _count: { modelCheckItems: countByModelId.get(row.model.id) ?? 0 } }
      : null;
    return {
      ...row,
      model,
      ...(Array.isArray(children)
        ? {
            childLineItems: attachModelCheckItemCounts(
              children as AttachedNode[],
              countByModelId,
            ),
          }
        : {}),
    };
  }) as Array<Omit<T, "model"> & { model: ModelWithCheckCount | null }>;
}

// ---------------------------------------------------------------------------
// kit attach (warehouse line-item-tree dimension)
// ---------------------------------------------------------------------------
//
// `kit` is dual-written to Convex; the warehouse tree readers used to keep it as
// a Prisma join solely because its `_count.kitCheckItems` could not come off the
// mirror. Now that `kit_check_item` is dual-written too, the whole kit node moves
// off Prisma: scalars from the Convex `kits` doc + the check-item count grafted
// from getKitCheckItemCountMap, matching the old
// `kit: { ..., _count: { kitCheckItems } }` include.

/** A Convex kit doc with the check-item count grafted on, matching the old
 * `kit: { ..., _count: { kitCheckItems } }` include. */
export type KitWithCheckCount = ConvexKit & { _count: { kitCheckItems: number } };

/** A line-item node carrying an optional `kitId` and a recursive subtree. */
type KitLineItemNode = { kitId?: string | null; childLineItems?: unknown };

/**
 * Walk a line-item tree and attach `kit` (the Convex `kits` doc + a grafted
 * `_count.kitCheckItems`) onto every node, recursing into `childLineItems`. A
 * node with no `kitId`, or whose kit is absent from the mirror, gets `kit: null`
 * — same as a Prisma join against a missing row, with NO Prisma fallback (a miss
 * surfaces mirror drift rather than hiding it). Returns new nodes; input is not
 * mutated. Run AFTER {@link attachLineItemTree} / {@link attachModelCheckItemCounts}.
 */
export function attachKitTree<T extends KitLineItemNode>(
  rows: T[],
  kitMap: Map<string, ConvexKit>,
  kitCountMap: Map<string, number>,
): Array<Omit<T, "kit"> & { kit: KitWithCheckCount | null }> {
  return rows.map((row) => {
    const children = row.childLineItems;
    const baseKit = row.kitId ? kitMap.get(row.kitId) ?? null : null;
    const kit: KitWithCheckCount | null = baseKit
      ? { ...baseKit, _count: { kitCheckItems: kitCountMap.get(baseKit.id) ?? 0 } }
      : null;
    return {
      ...row,
      kit,
      ...(Array.isArray(children)
        ? { childLineItems: attachKitTree(children as KitLineItemNode[], kitMap, kitCountMap) }
        : {}),
    };
  }) as Array<Omit<T, "kit"> & { kit: KitWithCheckCount | null }>;
}
