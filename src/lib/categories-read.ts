import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Categories domain (post Prisma-decommission).
 *
 * Convex is the sole owner of category data — the Prisma `category` table (and
 * the `model.categoryId`/`kit.categoryId` FKs and self-referential `parentId` it
 * anchored) was dropped at cutover. All reads, including cross-domain `category`
 * joins and dropdowns, go through Convex via this helper / the `use-categories`
 * hooks. See FEATUREDOCS/54.
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
// Convex is the sole read source. The self-referential parent/children
// hierarchy is rebuilt CLIENT-side in JS from the flat Convex list via a Map,
// and the cross-domain model/kit counts are aggregated in JS from the Convex
// model/kit lists.
//
// MAPPING: a Convex doc carries the same business fields as the Prisma row plus
// `_id`/`_creationTime` and numeric `createdAt`/`updatedAt`. `serialize()` keeps
// Date objects intact, so the old server action returned Dates — we MUST convert
// epoch-ms → Date here. Prisma-defaulted columns (sortOrder=0, tags=[],
// suggestedCrewRoles=[]) are coerced non-null. The cuid `id` is preserved; `_id`
// and `_creationTime` are stripped.
// ---------------------------------------------------------------------------

/**
 * A category mapped from its flat Convex doc to the Prisma-row business shape.
 * Derived from `Doc<"categories">` (R-8.2.4) so a schema change (new/renamed
 * field) is a compile error here instead of a silently-stale duplicate.
 */
export type MappedCategory = Omit<
  ConvexCategory,
  | "_id"
  | "_creationTime"
  | "parentId"
  | "description"
  | "icon"
  | "sortOrder"
  | "tags"
  | "suggestedCrewRoles"
  | "createdAt"
  | "updatedAt"
> & {
  parentId: string | null;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  tags: string[];
  suggestedCrewRoles: string[];
  createdAt: Date;
  updatedAt: Date;
};

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

// `listCategoriesWithCounts` / `getCategoryModelKitCounts` / `listCategoryTree` live in
// `@/lib/model-category-join` — they need both this module's categories AND
// `models-read.ts`'s models, and putting a Model↔Category join in either domain
// module would create a circular dependency between the two (POLICY.md R-3.5).
