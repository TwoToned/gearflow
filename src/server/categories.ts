"use server";

import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getModelMap } from "@/lib/models-read";
import {
  listCategoriesWithCounts,
  getCategoryModelKitCounts,
  listCategoryTree,
  collectDescendantCategoryIds,
  getMappedCategoriesByOrg,
} from "@/lib/categories-read";
import { serialize } from "@/lib/serialize";
import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { logActivity } from "@/lib/activity-log";

// Categories are DUAL-WRITTEN: every create/update/delete writes the Prisma
// `category` row (the durable FK anchor — model.categoryId + kit.categoryId carry
// a live nullable FK, plus the self-referential parentId) AND the Convex
// `categories` doc (the reactive read source). Prisma is written first; the Convex
// payload is derived from the written row via toConvexDoc so the two can't drift.
// Cross-domain joins + the category dropdowns in cross-domain-composing forms stay
// on the always-fresh Prisma mirror and migrate at decommission. See FEATUREDOCS/54.

/** Mirror a freshly written Prisma category row into Convex (create). */
async function mirrorCategoryToConvex(row: Record<string, unknown>) {
  await (await getConvexClient()).mutation(
    api.categories.createIfMissing,
    toConvexDoc(row) as FunctionArgs<typeof api.categories.createIfMissing>,
  );
}

/** Mirror an updated Prisma category row into Convex (patch, id stripped). */
async function patchCategoryInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...patch } = toConvexDoc(row);
  await (await getConvexClient()).mutation(api.categories.update, {
    id,
    patch: patch as FunctionArgs<typeof api.categories.update>["patch"],
  });
}

// Categories list — READ FROM CONVEX (Phase A). The parent/children hierarchy is
// rebuilt client-side from the flat Convex list; model + kit counts aggregate
// from the (dual-written) Convex model/kit lists. See src/lib/categories-read.ts.
export async function getCategories() {
  const { organizationId } = await getOrgContext();
  return serialize(await listCategoriesWithCounts(organizationId));
}

export async function getCategory(id: string) {
  const { organizationId } = await getOrgContext();

  const category = await prisma.category.findFirst({
    where: { id, organizationId },
    include: {
      parent: true,
      children: {
        include: { _count: { select: { models: true, kits: true, children: true } } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
      models: {
        include: {
          _count: { select: { assets: true } },
          media: {
            include: { file: true },
            orderBy: { sortOrder: "asc" },
            take: 1,
          },
        },
        orderBy: { name: "asc" },
      },
      kits: {
        include: {
          _count: { select: { serializedItems: true, bulkItems: true } },
        },
        orderBy: { name: "asc" },
      },
      _count: { select: { models: true, kits: true, children: true } },
    },
  });

  if (!category) throw new Error("Category not found");
  return serialize(category);
}

/**
 * Per-category model + kit counts (categoryId -> counts). Cross-domain: models
 * and kits still live in Prisma, so this can't come from Convex. Used by the
 * reactive category manager, which subscribes to the category list via Convex and
 * merges these (non-reactive) counts in. (Children counts are derived client-side
 * from the reactive list itself.)
 */
export async function getCategoryCounts(): Promise<Record<string, { models: number; kits: number }>> {
  const { organizationId } = await getOrgContext();
  // Models AND kits live in Convex — count by categoryId in JS from both lists.
  return serialize(await getCategoryModelKitCounts(organizationId));
}

// Category tree — READ FROM CONVEX (Phase A). Tree rebuilt client-side from the
// flat Convex list; `_count.models` from the Convex model list.
export async function getCategoryTree() {
  const { organizationId } = await getOrgContext();
  return serialize(await listCategoryTree(organizationId));
}

// Get category + all descendant IDs for container cases.
export async function getCaseCategoryIds(): Promise<string[]> {
  const { organizationId } = await getOrgContext();

  // Read prepKitCategoryId from org settings
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { metadata: true },
  });
  const settings = org?.metadata ? JSON.parse(org.metadata as string) : {};
  const rootCatId = settings.prepKitCategoryId;
  if (!rootCatId) return [];

  // The category tree walk reads from Convex (categories are dual-written). The
  // org.metadata read above stays Prisma: the `organization` table is owned by
  // Better Auth, not part of the domain-data dual-write set.
  const allCats = await getMappedCategoriesByOrg(organizationId);
  return collectDescendantCategoryIds(allCats, rootCatId);
}

// ---------------------------------------------------------------------------
// searchContainerAssets — search assets in the configured container category
// ---------------------------------------------------------------------------
export async function searchContainerAssets(query: string = "") {
  const { organizationId } = await getOrgContext();
  const categoryIds = await getCaseCategoryIds();
  if (categoryIds.length === 0) return serialize([]);

  const assets = await prisma.asset.findMany({
    where: {
      organizationId,
      model: { categoryId: { in: categoryIds } },
      ...(query
        ? {
            OR: [
              { assetTag: { contains: query, mode: "insensitive" } },
              { customName: { contains: query, mode: "insensitive" } },
              { model: { name: { contains: query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      assetTag: true,
      customName: true,
      modelId: true,
    },
    orderBy: { assetTag: "asc" },
    take: 20,
  });

  const modelMap = await getModelMap(organizationId);

  return serialize(
    assets.map((a) => ({
      value: a.customName || a.assetTag,
      label: a.customName
        ? `${a.customName} (${a.assetTag})`
        : `${a.modelId ? modelMap.get(a.modelId)?.name : undefined} — ${a.assetTag}`,
      assetId: a.id,
      assetTag: a.assetTag,
      modelId: a.modelId,
    }))
  );
}

export async function createCategory(data: CategoryFormValues) {
  const { organizationId, userId, userName } = await requirePermission("model", "create");
  const parsed = categorySchema.parse(data);
  const result = await prisma.category.create({
    data: {
      ...parsed,
      parentId: parsed.parentId || null,
      organizationId,
    },
  });
  await mirrorCategoryToConvex(result);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "category",
    entityId: result.id,
    entityName: result.name,
    summary: `Created category ${result.name}`,
  });

  return serialize(result);
}

export async function updateCategory(id: string, data: CategoryFormValues) {
  const { organizationId, userId, userName } = await requirePermission("model", "update");
  const parsed = categorySchema.parse(data);
  const updated = await prisma.category.update({
    where: { id, organizationId },
    data: {
      ...parsed,
      parentId: parsed.parentId || null,
    },
  });
  await patchCategoryInConvex(id, updated);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "category",
    entityId: updated.id,
    entityName: updated.name,
    summary: `Updated category ${updated.name}`,
  });

  return serialize(updated);
}

export async function deleteCategory(id: string) {
  const { organizationId, userId, userName } = await requirePermission("model", "delete");
  // Check for children or models first
  const category = await prisma.category.findUnique({
    where: { id, organizationId },
    include: { _count: { select: { children: true, models: true } } },
  });
  if (!category) throw new Error("Category not found");
  if (category._count.children > 0) throw new Error("Cannot delete category with subcategories");
  if (category._count.models > 0) throw new Error("Cannot delete category with models");

  await prisma.category.delete({ where: { id, organizationId } });
  await (await getConvexClient()).mutation(api.categories.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "category",
    entityId: id,
    entityName: category.name,
    summary: `Deleted category ${category.name}`,
    details: { deleted: { name: category.name } },
  });

  return serialize({ id });
}
