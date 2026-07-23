import { getModelsByOrg, type ConvexModel } from "@/lib/models-read";
import { getKitsByOrg } from "@/lib/kits-read";
import {
  getCategoryMap,
  getMappedCategoriesByOrg,
  buildCategoriesWithCounts,
  buildCategoryTree,
  buildModelKitCounts,
  type ConvexCategory,
  type CategoryWithCounts,
  type CategoryTreeNode,
} from "@/lib/categories-read";

/**
 * Cross-domain Model↔Category joins (Phase 3 cutover).
 *
 * Split out of `models-read.ts` / `categories-read.ts` because each domain's
 * own reads (`getModelsByOrg`, `getCategoryMap`) are needed by the OTHER
 * domain's join here — keeping the join in either file would create a
 * circular dependency between the two domain modules (POLICY.md R-3.5). This
 * module is the one place allowed to depend on both.
 */

/** A Convex model with its equipment `category` resolved (nested) — mirrors a
 *  Prisma `model: { include: { category } }` join for the cross-domain reads that
 *  display `model.category.name` (CSV exports, reorder, utilization, reports). */
export type ModelWithCategory = ConvexModel & { category: ConvexCategory | null };

/**
 * Map of modelId → model with its nested equipment category, replacing a Prisma
 * `model: { include: { category } }` join. Two Convex round-trips (models +
 * categories), deduped per call.
 */
export async function getModelWithCategoryMap(
  orgId: string,
): Promise<Map<string, ModelWithCategory>> {
  const [models, categoryMap] = await Promise.all([
    getModelsByOrg(orgId),
    getCategoryMap(orgId),
  ]);
  return new Map(
    models.map((m) => [
      m.id,
      { ...m, category: m.categoryId ? categoryMap.get(m.categoryId) ?? null : null },
    ]),
  );
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
