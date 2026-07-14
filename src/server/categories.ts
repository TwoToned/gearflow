"use server";

import { createId } from "@paralleldrive/cuid2";
import { readOrgSettingsBlob } from "@/lib/org-settings-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getModelMap, mapConvexModelToRow, getModelsByOrg } from "@/lib/models-read";
import { getPrimaryPhotoMap } from "@/lib/media-read";
import {
  listCategoriesWithCounts,
  listCategoryTree,
  collectDescendantCategoryIds,
  getMappedCategoriesByOrg,
  getCategoryById,
  mapCategory,
  buildModelKitCounts,
  buildChildCountMap,
  sortCategories,
  type MappedCategory,
} from "@/lib/categories-read";
import { getKitsByOrg, getKitSerializedItemsByOrg, getKitBulkItemsByOrg, countKitMembers } from "@/lib/kits-read";
import { getAssetsByOrg, filterContainerAssets, sortByAssetTagAsc } from "@/lib/assets-read";
import { serialize } from "@/lib/serialize";
import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { logActivity } from "@/lib/activity-log";

// Equipment Categories are CONVEX-ONLY (Phase B write inversion): every
// create/update/delete writes the Convex `categories` doc as the sole source of
// truth — no Prisma row, no mirror. The inbound Prisma FKs into `category`
// (model.categoryId, kit.categoryId, and the self-ref category.parentId — ALL
// SetNull) were dropped (migration 20260617131300_drop_category_fk_constraints),
// so each is now a plain string holding the Convex cuid.
//
// Invariants re-implemented in app code (Convex has no constraints/cascades):
//  - Delete guards: re-implemented from Convex counts — "Cannot delete category
//    with subcategories" if children > 0; "Cannot delete category with models" if
//    models > 0 (matches the old `_count` guard, exact messages preserved).
//  - No cascade: all three inbound FKs were SetNull, so deleting a category just
//    orphaned the referencing categoryId/parentId. Reads tolerate a missing
//    category, so no cascade re-implementation is needed.
//  - Org-guard: reads the target via getCategoryById and verifies organizationId
//    before any update/remove (matches the old where:{id,organizationId}).
//  - The self-ref parent tree is rebuilt client-side in categories-read.
//
// Reads (list, tree, counts, detail) already source from Convex via
// categories-read. See FEATUREDOCS/54 + docs/designs/convex-decommission-RUNBOOK.md.

// Categories list — READ FROM CONVEX (Phase A). The parent/children hierarchy is
// rebuilt client-side from the flat Convex list; model + kit counts aggregate
// from the (dual-written) Convex model/kit lists. See src/lib/categories-read.ts.
export async function getCategories() {
  const { organizationId } = await getOrgContext();
  return serialize(await listCategoriesWithCounts(organizationId));
}

export async function getCategory(id: string) {
  const { organizationId } = await getOrgContext();

  // Categories are CONVEX-ONLY (Phase B). The whole deep include
  // (parent / children + their _count / kits + member _count / _count) is rebuilt
  // from the Convex domain lists, since the inbound Category FKs were dropped.
  const [allCats, allModels, allKits, allKitSerialized, allKitBulk] = await Promise.all([
    getMappedCategoriesByOrg(organizationId),
    getModelsByOrg(organizationId),
    getKitsByOrg(organizationId),
    getKitSerializedItemsByOrg(organizationId),
    getKitBulkItemsByOrg(organizationId),
  ]);

  const category = allCats.find((c) => c.id === id);
  if (!category) throw new Error("Category not found");

  const modelKitCounts = buildModelKitCounts(allModels, allKits);
  const childCounts = buildChildCountMap(allCats);
  const ownCounts = modelKitCounts.get(id) ?? { models: 0, kits: 0 };

  // parent (full row, or null) — was `parent: true`.
  const parent = category.parentId ? allCats.find((c) => c.id === category.parentId) ?? null : null;

  // children + their _count {models, kits, children}, sortOrder then name — was
  // `children: { include: { _count }, orderBy: [sortOrder, name] }`.
  const children = sortCategories(allCats.filter((c) => c.parentId === id)).map((c) => ({
    ...c,
    _count: {
      models: modelKitCounts.get(c.id)?.models ?? 0,
      kits: modelKitCounts.get(c.id)?.kits ?? 0,
      children: childCounts.get(c.id) ?? 0,
    },
  }));

  // kits in this category + member counts, name ASC — was
  // `kits: { include: { _count: { serializedItems, bulkItems } }, orderBy: name }`.
  const kitMemberCounts = countKitMembers(allKitSerialized, allKitBulk);
  const kits = allKits
    .filter((k) => k.categoryId === id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((k) => ({
      ...k,
      _count: kitMemberCounts[k.id] ?? { serializedItems: 0, bulkItems: 0 },
    }));

  // Models are CONVEX-ONLY — rebuild the per-model `{ _count.assets, media[primary] }`
  // list (name ASC, active only — matching the old include) from the Convex mirror.
  const [modelMap, allAssets, photoMap] = await Promise.all([
    getModelMap(organizationId),
    getAssetsByOrg(organizationId),
    getPrimaryPhotoMap("model", organizationId),
  ]);
  const assetCount = new Map<string, number>();
  for (const a of allAssets) if (a.isActive !== false) assetCount.set(a.modelId, (assetCount.get(a.modelId) ?? 0) + 1);
  const models = [...modelMap.values()]
    .filter((m) => m.categoryId === id && m.isActive !== false)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => {
      const photo = photoMap[m.id];
      return {
        ...mapConvexModelToRow(m),
        _count: { assets: assetCount.get(m.id) ?? 0 },
        media: photo ? [{ url: photo.url, thumbnailUrl: photo.thumbnailUrl }] : [],
      };
    });

  return serialize({
    ...category,
    parent,
    children,
    kits,
    _count: { models: ownCounts.models, kits: ownCounts.kits, children: childCounts.get(id) ?? 0 },
    models,
  });
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

  // prepKitCategoryId lives in the Convex org-settings blob now (org settings were
  // inverted off the Better Auth org row); reading Postgres metadata would be stale.
  const settings = await readOrgSettingsBlob(organizationId);
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

  // Assets come off the dual-written Convex `assets` list; the `model.categoryId`
  // relational filter + OR text filter are replicated by filterContainerAssets,
  // resolving the joined model fields from the Convex model map (Phase A).
  const [allAssets, modelMap] = await Promise.all([
    getAssetsByOrg(organizationId),
    getModelMap(organizationId),
  ]);
  const categoryIdSet = new Set(categoryIds);
  const matched = sortByAssetTagAsc(
    filterContainerAssets(
      allAssets,
      categoryIdSet,
      query,
      (modelId) => (modelId ? modelMap.get(modelId)?.categoryId ?? null : null),
      (modelId) => (modelId ? modelMap.get(modelId)?.name ?? null : null),
    ),
  ).slice(0, 20);

  return serialize(
    matched.map((a) => ({
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

  // Explicit cuid so external references hold the same id Convex stores.
  const id = createId();
  const now = Date.now();
  await (await getConvexClient()).mutation(api.categories.create, {
    id,
    organizationId,
    name: parsed.name,
    parentId: parsed.parentId || undefined,
    description: parsed.description || undefined,
    icon: parsed.icon || undefined,
    sortOrder: parsed.sortOrder ?? 0,
    tags: parsed.tags ?? [],
    suggestedCrewRoles: [],
    createdAt: now,
    updatedAt: now,
  });

  const result: MappedCategory = {
    id,
    organizationId,
    name: parsed.name,
    parentId: parsed.parentId || null,
    description: parsed.description || null,
    icon: parsed.icon || null,
    sortOrder: parsed.sortOrder ?? 0,
    tags: parsed.tags ?? [],
    suggestedCrewRoles: [],
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };

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

  const existing = await getCategoryById(id);
  if (!existing || existing.organizationId !== organizationId) throw new Error("Category not found");

  // Convex `db.patch` treats `undefined` as field removal, matching the old
  // Prisma `parentId || null` / optional-field clears.
  await (await getConvexClient()).mutation(api.categories.update, {
    id,
    patch: {
      name: parsed.name,
      parentId: parsed.parentId || undefined,
      description: parsed.description || undefined,
      icon: parsed.icon || undefined,
      sortOrder: parsed.sortOrder ?? 0,
      tags: parsed.tags ?? [],
      updatedAt: Date.now(),
    },
  });

  const updated: MappedCategory = {
    ...mapCategory(existing),
    name: parsed.name,
    parentId: parsed.parentId || null,
    description: parsed.description || null,
    icon: parsed.icon || null,
    sortOrder: parsed.sortOrder ?? 0,
    tags: parsed.tags ?? [],
    updatedAt: new Date(),
  };

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

  const category = await getCategoryById(id);
  if (!category || category.organizationId !== organizationId) throw new Error("Category not found");

  // Delete guards re-implemented from Convex counts (replaces the old Prisma
  // `_count: { children, models }`). Children = categories whose parentId is this
  // id; models = Convex models whose categoryId is this id.
  const [allCats, allModels, allKits] = await Promise.all([
    getMappedCategoriesByOrg(organizationId),
    getModelsByOrg(organizationId),
    getKitsByOrg(organizationId),
  ]);
  const childCount = allCats.filter((c) => c.parentId === id).length;
  if (childCount > 0) throw new Error("Cannot delete category with subcategories");
  const modelCount = buildModelKitCounts(allModels, allKits).get(id)?.models ?? 0;
  if (modelCount > 0) throw new Error("Cannot delete category with models");

  // No cascade: the dropped inbound FKs were SetNull, so deleting a category just
  // orphaned the referencing kit.categoryId — reads tolerate a missing category.
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
