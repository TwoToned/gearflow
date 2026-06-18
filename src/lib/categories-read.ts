import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { getModelsByOrg } from "@/lib/models-read";
import { getKitsByOrg } from "@/lib/kits-read";

/**
 * Server-side read helpers for the Categories domain (Phase 3 cutover).
 *
 * Categories are dual-written like Suppliers/Locations/Models: every
 * create/update/delete writes BOTH the Prisma `category` row (the durable FK
 * anchor — `model.categoryId` and `kit.categoryId` carry a live, nullable FK, and
 * the self-referential `parentId`) AND the Convex `categories` doc (the reactive
 * read source). A Convex-only category would FK-fail the moment it's assigned to a
 * model or kit, so Prisma stays the anchor. Reads that want reactivity — the
 * category manager — go through Convex via this helper / the `use-categories`
 * hooks. Cross-domain `category` joins and the dropdowns in cross-domain-composing
 * forms stay on the always-fresh Prisma mirror and migrate at decommission.
 * See FEATUREDOCS/54.
 */
export type ConvexCategory = Doc<"categories">;

export async function getCategoryById(id: string): Promise<ConvexCategory | null> {
  return await (await getConvexClient()).query(api.categories.getById, { id });
}

export async function getCategoriesByOrg(orgId: string): Promise<ConvexCategory[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.categories.list, { orgId }),
  );
}

/** All of an org's categories keyed by cuid `id`, for attaching to joined rows. */
export async function getCategoryMap(orgId: string): Promise<Map<string, ConvexCategory>> {
  const all = await getCategoriesByOrg(orgId);
  return new Map(all.map((c) => [c.id, c]));
}

// ---------------------------------------------------------------------------
// Primary reads — list / tree / counts / case-category walk (Phase A)
//
// These replace the pure Prisma list/tree/filter reads in server/categories.ts.
// Categories are dual-written, so the Convex list is the read source. The
// self-referential parent/children hierarchy is rebuilt CLIENT-side in JS from
// the flat Convex list via a Map, and the cross-domain model/kit counts are
// aggregated in JS from the (also-dual-written) Convex model/kit lists.
//
// MAPPING: a Convex doc carries the same business fields as the Prisma row plus
// `_id`/`_creationTime` and numeric `createdAt`/`updatedAt`. `serialize()` keeps
// Date objects intact, so the old server action returned Dates — we MUST convert
// epoch-ms → Date here. Prisma-defaulted columns (sortOrder=0, tags=[],
// suggestedCrewRoles=[]) are coerced non-null. The cuid `id` is preserved; `_id`
// and `_creationTime` are stripped.
// ---------------------------------------------------------------------------

/** A category mapped from its flat Convex doc to the Prisma-row business shape. */
export interface MappedCategory {
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  tags: string[];
  suggestedCrewRoles: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** Pure: Convex category doc → Prisma-row business shape (epoch-ms→Date, defaults coerced, `_id`/`_creationTime` stripped). */
export function mapCategory(doc: ConvexCategory): MappedCategory {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    name: doc.name,
    parentId: doc.parentId ?? null,
    description: doc.description ?? null,
    icon: doc.icon ?? null,
    sortOrder: doc.sortOrder ?? 0,
    tags: doc.tags ?? [],
    suggestedCrewRoles: doc.suggestedCrewRoles ?? [],
    createdAt: new Date(doc.createdAt ?? 0),
    updatedAt: new Date(doc.updatedAt ?? 0),
  };
}

/**
 * Pure: replicate Prisma's `orderBy: [{ sortOrder: "asc" }, { name: "asc" }]`.
 * Postgres has no nulls to consider here (both columns are non-null). Returns a
 * NEW sorted array (does not mutate the input).
 */
export function sortCategories<T extends { sortOrder: number; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * Pure: count children per parentId from the flat category list. A category's
 * children count = number of categories whose `parentId` === its `id`.
 */
export function buildChildCountMap(cats: Array<{ id: string; parentId: string | null }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cats) {
    if (c.parentId) counts.set(c.parentId, (counts.get(c.parentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pure: per-category {models, kits} counts from the flat model/kit lists
 * (each carries an optional `categoryId`). Replaces the Prisma `_count.models`
 * relation + the `kit` groupBy.
 */
export function buildModelKitCounts(
  models: Array<{ categoryId?: string | null }>,
  kits: Array<{ categoryId?: string | null }>,
): Map<string, { models: number; kits: number }> {
  const counts = new Map<string, { models: number; kits: number }>();
  const ensure = (id: string) => {
    let e = counts.get(id);
    if (!e) counts.set(id, (e = { models: 0, kits: 0 }));
    return e;
  };
  for (const m of models) if (m.categoryId) ensure(m.categoryId).models++;
  for (const k of kits) if (k.categoryId) ensure(k.categoryId).kits++;
  return counts;
}

/** A mapped category with its parent (full row) and relation counts — the `getCategories` row shape. */
export type CategoryWithCounts = MappedCategory & {
  parent: MappedCategory | null;
  _count: { models: number; kits: number; children: number };
};

/**
 * Pure: build the `getCategories` list — each category with its parent row and
 * `_count {models, kits, children}`, sorted by sortOrder then name. Replicates
 * `findMany({ include: { parent, _count }, orderBy: [sortOrder, name] })`.
 */
export function buildCategoriesWithCounts(
  cats: MappedCategory[],
  modelKitCounts: Map<string, { models: number; kits: number }>,
): CategoryWithCounts[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const childCounts = buildChildCountMap(cats);
  return sortCategories(cats).map((c) => ({
    ...c,
    parent: c.parentId ? byId.get(c.parentId) ?? null : null,
    _count: {
      models: modelKitCounts.get(c.id)?.models ?? 0,
      kits: modelKitCounts.get(c.id)?.kits ?? 0,
      children: childCounts.get(c.id) ?? 0,
    },
  }));
}

/** A tree node: a mapped category with `_count.models` and recursively-nested children. */
export type CategoryTreeNode = MappedCategory & {
  _count: { models: number };
  children: CategoryTreeNode[];
};

/**
 * Pure: build the `getCategoryTree` forest — roots-first, each node carrying
 * `_count.models` and its nested `children`. Replicates the original two-pass
 * Map build (a node whose parentId is missing from the set becomes a root). Both
 * the roots and each children array are sorted by sortOrder then name.
 */
export function buildCategoryTree(
  cats: MappedCategory[],
  modelCounts: Map<string, number>,
): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>();
  for (const c of cats) {
    nodes.set(c.id, { ...c, _count: { models: modelCounts.get(c.id) ?? 0 }, children: [] });
  }
  const roots: CategoryTreeNode[] = [];
  for (const c of cats) {
    const node = nodes.get(c.id)!;
    if (c.parentId && nodes.has(c.parentId)) {
      nodes.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  for (const node of nodes.values()) node.children = sortCategories(node.children);
  return sortCategories(roots);
}

/**
 * Pure: BFS the category tree from `rootCatId`, returning that id plus all
 * descendant ids. Replicates the `getCaseCategoryIds` walk over a flat
 * {id, parentId} list. Returns `[]` if `rootCatId` is falsy.
 */
export function collectDescendantCategoryIds(
  cats: Array<{ id: string; parentId: string | null }>,
  rootCatId: string | null | undefined,
): string[] {
  if (!rootCatId) return [];
  const childrenMap = new Map<string, string[]>();
  for (const c of cats) {
    if (c.parentId) {
      const list = childrenMap.get(c.parentId);
      if (list) list.push(c.id);
      else childrenMap.set(c.parentId, [c.id]);
    }
  }
  const result: string[] = [];
  const queue = [rootCatId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    const kids = childrenMap.get(id);
    if (kids) queue.push(...kids);
  }
  return result;
}

/** All of an org's categories mapped to the Prisma-row business shape. */
export async function getMappedCategoriesByOrg(orgId: string): Promise<MappedCategory[]> {
  const docs = await getCategoriesByOrg(orgId);
  return docs.map(mapCategory);
}

/** `getCategories` from Convex: each category + parent + `_count {models, kits, children}`. */
export async function listCategoriesWithCounts(orgId: string): Promise<CategoryWithCounts[]> {
  const [cats, models, kits] = await Promise.all([
    getMappedCategoriesByOrg(orgId),
    getModelsByOrg(orgId),
    getKitsByOrg(orgId),
  ]);
  return buildCategoriesWithCounts(cats, buildModelKitCounts(models, kits));
}

/** `getCategoryCounts` from Convex: categoryId → {models, kits}, as a plain record. */
export async function getCategoryModelKitCounts(
  orgId: string,
): Promise<Record<string, { models: number; kits: number }>> {
  const [models, kits] = await Promise.all([getModelsByOrg(orgId), getKitsByOrg(orgId)]);
  const counts = buildModelKitCounts(models, kits);
  const out: Record<string, { models: number; kits: number }> = {};
  for (const [id, v] of counts) out[id] = v;
  return out;
}

/** `getCategoryTree` from Convex: roots-first forest with `_count.models` + nested children. */
export async function listCategoryTree(orgId: string): Promise<CategoryTreeNode[]> {
  const [cats, models] = await Promise.all([getMappedCategoriesByOrg(orgId), getModelsByOrg(orgId)]);
  const modelCounts = new Map<string, number>();
  for (const m of models) if (m.categoryId) modelCounts.set(m.categoryId, (modelCounts.get(m.categoryId) ?? 0) + 1);
  return buildCategoryTree(cats, modelCounts);
}
