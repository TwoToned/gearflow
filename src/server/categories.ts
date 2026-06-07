"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { logActivity } from "@/lib/activity-log";

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
      model: { select: { name: true } },
    },
    orderBy: { assetTag: "asc" },
    take: 20,
  });

  return serialize(
    assets.map((a) => ({
      value: a.customName || a.assetTag,
      label: a.customName
        ? `${a.customName} (${a.assetTag})`
        : `${a.model?.name} — ${a.assetTag}`,
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
