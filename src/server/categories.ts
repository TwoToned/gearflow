"use server";

import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getModelMap } from "@/lib/models-read";
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

export async function getCategories() {
  const { organizationId } = await getOrgContext();
  return serialize(
    await prisma.category.findMany({
      where: { organizationId },
      include: { parent: true, _count: { select: { models: true, kits: true, children: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    })
  );
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
  const [modelGroups, kitGroups] = await Promise.all([
    prisma.model.groupBy({ by: ["categoryId"], where: { organizationId, categoryId: { not: null } }, _count: { _all: true } }),
    prisma.kit.groupBy({ by: ["categoryId"], where: { organizationId, categoryId: { not: null } }, _count: { _all: true } }),
  ]);
  const counts: Record<string, { models: number; kits: number }> = {};
  const ensure = (id: string) => (counts[id] ??= { models: 0, kits: 0 });
  for (const g of modelGroups) if (g.categoryId) ensure(g.categoryId).models = g._count._all;
  for (const g of kitGroups) if (g.categoryId) ensure(g.categoryId).kits = g._count._all;
  return serialize(counts);
}

export async function getCategoryTree() {
  const { organizationId } = await getOrgContext();
  const categories = await prisma.category.findMany({
    where: { organizationId },
    include: { _count: { select: { models: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  // Build tree structure
  const map = new Map<string, typeof categories[0] & { children: typeof categories }>();
  const roots: (typeof categories[0] & { children: typeof categories })[] = [];

  for (const cat of categories) {
    map.set(cat.id, { ...cat, children: [] });
  }
  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parentId && map.has(cat.parentId)) {
      map.get(cat.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return serialize(roots);
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

  // Fetch all categories and walk the tree
  const allCats = await prisma.category.findMany({
    where: { organizationId },
    select: { id: true, parentId: true },
  });

  const childrenMap = new Map<string, string[]>();
  for (const cat of allCats) {
    if (cat.parentId) {
      const list = childrenMap.get(cat.parentId) || [];
      list.push(cat.id);
      childrenMap.set(cat.parentId, list);
    }
  }

  // BFS from root
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
