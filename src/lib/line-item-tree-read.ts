import { getModelsByOrg, type ConvexModel } from "@/lib/models-read";
import { getSuppliersByOrg, type ConvexSupplier } from "@/lib/suppliers-read";
import { getCategoriesByOrg, type ConvexCategory } from "@/lib/categories-read";

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
 * `*_media` and `model_check_item` cross-domain joins are NOT served here — those
 * tables are not dual-written to Convex yet, so any read of them stays on Prisma
 * (e.g. warehouse's `model._count.modelCheckItems`, deferred to a later session).
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
