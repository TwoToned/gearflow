"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { projectCategorySchema, type ProjectCategoryFormValues } from "@/lib/validations/project-category";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { writeCollabActivityEvent } from "@/lib/collaboration-activity";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { computeOverbookedStatus } from "@/lib/availability";
import { getProjectById } from "@/lib/projects-read";
import {
  buildLineItemAttachMaps,
  attachLineItemTree,
  resolveAttachedSupplier,
} from "@/lib/line-item-tree-read";

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getProjectCategories(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const client = await getConvexClient();

  // 1. Convex: categories + groups + slots
  const [convexCategories, convexGroups] = await Promise.all([
    client.query(api.projectCategories.listByProject, { projectId, orgId: organizationId }),
    client.query(api.projectGroups.listByProject, { projectId, orgId: organizationId }),
  ]);

  // Fetch all category slots in parallel (one call per category, typically ≤10)
  const slotArrays = await Promise.all(
    convexCategories.map((cat) => client.query(api.categorySlots.list, { projectCategoryId: cat.id })),
  );
  const allSlots = slotArrays.flat();
  const slotByGroupId = new Map(allSlots.filter((s) => s.projectGroupId).map((s) => [s.projectGroupId!, s]));
  const slotBySubHireGroupId = new Map(allSlots.filter((s) => s.subHireGroupId).map((s) => [s.subHireGroupId!, s]));

  // 2. Prisma: line items + sub-hire groups (still Prisma domain)
  const lineItemInclude = {
    asset: true,
    bulkAsset: true,
    kit: true,
    childLineItems: {
      include: { asset: true, bulkAsset: true, kit: true },
      orderBy: { sortOrder: "asc" as const },
    },
  };

  const [allLineItems, subHireGroups] = await Promise.all([
    prisma.projectLineItem.findMany({
      where: { projectId, organizationId },
      include: lineItemInclude,
      orderBy: { sortOrder: "asc" },
    }),
    prisma.subHireGroup.findMany({
      where: {
        subHire: { projectId, organizationId },
        targetCategoryId: { not: null },
      },
      include: {
        subHire: { select: { id: true, orderNumber: true, status: true, supplierId: true } },
        items: true,
        lineItems: {
          where: { isKitChild: false, parentLineItemId: null },
          include: lineItemInclude,
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  // 3. Build lookup maps
  const attachMaps = await buildLineItemAttachMaps(organizationId);

  const lineItemsByGroupId = new Map<string, typeof allLineItems[number][]>();
  const lineItemsByCatId = new Map<string, typeof allLineItems[number][]>();
  for (const li of allLineItems) {
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

  const subHireGroupsByCategory = new Map<string, typeof subHireGroups[number][]>();
  for (const sg of subHireGroups) {
    if (!sg.targetCategoryId) continue;
    const arr = subHireGroupsByCategory.get(sg.targetCategoryId) ?? [];
    arr.push(sg);
    subHireGroupsByCategory.set(sg.targetCategoryId, arr);
  }

  const groupsByCategoryId = new Map<string, typeof convexGroups[number][]>();
  for (const g of convexGroups) {
    if (g.categoryId) {
      const arr = groupsByCategoryId.get(g.categoryId) ?? [];
      arr.push(g);
      groupsByCategoryId.set(g.categoryId, arr);
    }
  }

  // 4. Reconstruct categories
  const withMixed = convexCategories
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((cat) => {
      type MixedSlot =
        | { kind: "project"; sortOrder: number; projectGroupId: string }
        | { kind: "subHire"; sortOrder: number; subHireGroupId: string };

      const catGroups = (groupsByCategoryId.get(cat.id) ?? [])
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((g) => {
          const slot = slotByGroupId.get(g.id);
          return {
            ...g,
            price: g.price ?? null,
            suggestedPrice: g.suggestedPrice ?? null,
            rentalPeriod: g.rentalPeriod ?? null,
            rentalQuantity: g.rentalQuantity ?? null,
            createdAt: new Date(g.createdAt ?? 0),
            updatedAt: new Date(g.updatedAt ?? 0),
            slot: slot
              ? { ...slot, createdAt: new Date(slot.createdAt ?? 0), updatedAt: new Date(slot.updatedAt ?? 0) }
              : null,
            lineItems: attachLineItemTree(lineItemsByGroupId.get(g.id) ?? [], attachMaps),
          };
        });

      const catSubHireGroups = (subHireGroupsByCategory.get(cat.id) ?? []).map((sg) => {
        const slot = slotBySubHireGroupId.get(sg.id);
        return {
          ...sg,
          slot: slot
            ? { ...slot, createdAt: new Date(slot.createdAt ?? 0), updatedAt: new Date(slot.updatedAt ?? 0) }
            : null,
          subHire: {
            ...sg.subHire,
            supplier: resolveAttachedSupplier(sg.subHire.supplierId, attachMaps),
          },
          lineItems: attachLineItemTree(sg.lineItems, attachMaps),
        };
      });

      const mixedGroups: MixedSlot[] = [
        ...catGroups.map((g) => ({
          kind: "project" as const,
          sortOrder: g.slot?.sortOrder ?? g.sortOrder ?? 0,
          projectGroupId: g.id,
        })),
        ...catSubHireGroups.map((sg) => ({
          kind: "subHire" as const,
          sortOrder: sg.slot?.sortOrder ?? sg.sortOrder ?? 0,
          subHireGroupId: sg.id,
        })),
      ].sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        ...cat,
        createdAt: new Date(cat.createdAt ?? 0),
        updatedAt: new Date(cat.updatedAt ?? 0),
        groups: catGroups,
        subHireGroupTargets: catSubHireGroups,
        lineItems: attachLineItemTree(lineItemsByCatId.get(cat.id) ?? [], attachMaps),
        mixedGroups,
      };
    });

  return serialize(withMixed);
}

export async function getUncategorizedLineItems(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  // Line items are still Prisma-primary
  const items = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      organizationId,
      categoryId: null,
      groupId: null,
    },
    include: {
      asset: true,
      bulkAsset: true,
      kit: true,
      childLineItems: {
        include: { asset: true, bulkAsset: true, kit: true },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
  const attachMaps = await buildLineItemAttachMaps(organizationId);
  return serialize(attachLineItemTree(items, attachMaps));
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createProjectCategory(
  projectId: string,
  data: ProjectCategoryFormValues,
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = projectCategorySchema.parse(data);
  const client = await getConvexClient();

  // Atomic create-at-end: max(sortOrder)+1 computed inside the mutation (no TOCTOU).
  const id = createId();
  const now = Date.now();
  const { sortOrder } = await client.mutation(api.projectCategories.createAtEnd, {
    id,
    organizationId,
    projectId,
    name: parsed.name,
    now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "project",
    entityId: projectId,
    entityName: parsed.name,
    summary: `Created category "${parsed.name}"`,
  });

  return serialize({ id, organizationId, projectId, name: parsed.name, sortOrder, createdAt: new Date(now), updatedAt: new Date(now) });
}

export async function updateProjectCategory(
  categoryId: string,
  data: Partial<ProjectCategoryFormValues>,
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  const category = await client.query(api.projectCategories.getById, { id: categoryId });
  if (!category || category.organizationId !== organizationId) {
    throw new Error("Category not found");
  }

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder);

  await client.mutation(api.projectCategories.update, { id: categoryId, patch });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: category.projectId,
    entityName: category.name,
    summary: `Updated category "${category.name}"`,
  });

  if (data.name !== undefined) {
    await writeCollabActivityEvent(
      { organizationId, userId, userName },
      {
        entityType: "project",
        entityId: category.projectId,
        action: "category_updated",
        summary: `renamed a category to "${data.name}"`,
        targetType: "category",
        targetId: categoryId,
      },
    );
  }

  return serialize({ ...category, ...patch, createdAt: new Date(category.createdAt ?? 0), updatedAt: new Date(patch.updatedAt as number) });
}

export async function deleteProjectCategory(categoryId: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  const category = await client.query(api.projectCategories.getById, { id: categoryId });
  if (!category || category.organizationId !== organizationId) {
    throw new Error("Category not found");
  }

  // 1. Get all groups in this category from Convex
  const categoryGroups = await client.query(api.projectGroups.listByCategoryId, { categoryId });

  // 2. Get IDs of all line items in this category (for cascade null-out)
  const groupIds = categoryGroups.map((g) => g.id);
  const allLineItems = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      OR: [
        { groupId: { in: groupIds.length > 0 ? groupIds : ["__none__"] } },
        { categoryId, groupId: null },
      ],
    },
    select: { id: true },
  });
  const lineItemIds = allLineItems.map((li) => li.id);

  // 3. Null out categoryId/groupId on line items (Prisma - line items still Prisma-primary)
  if (lineItemIds.length > 0) {
    await prisma.projectLineItem.updateMany({
      where: { id: { in: lineItemIds } },
      data: { categoryId: null, groupId: null },
    });
  }

  // 4. Atomic Convex cascade: all groups (+ their slots), all category slots,
  //    then the category — one transaction, no partial-cascade on mid-failure.
  await client.mutation(api.projectCategories.deleteCascade, { categoryId });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "project",
    entityId: category.projectId,
    entityName: category.name,
    summary: `Deleted category "${category.name}" — ${lineItemIds.length} items moved to uncategorized`,
  });

  return serialize({ success: true });
}

export async function reorderProjectCategories(
  projectId: string,
  orderedIds: string[],
) {
  await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  // Atomic reorder: contiguous sortOrder guaranteed in one transaction.
  await client.mutation(api.projectCategories.reorder, { orderedIds, now: Date.now() });

  return serialize({ success: true });
}

/**
 * Returns a map of lineItemId → overbookedInfo for all line items in a project.
 */
export async function getProjectOverbookedStatus(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");

  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) {
    return serialize({});
  }

  const lineItems = await prisma.projectLineItem.findMany({
    where: { projectId, status: { not: "CANCELLED" } },
    select: {
      id: true,
      modelId: true,
      kitId: true,
      quantity: true,
      isKitChild: true,
      parentLineItemId: true,
      status: true,
      subHireId: true,
    },
  });

  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    lineItems,
    project.rentalStartDate != null ? new Date(project.rentalStartDate) : null,
    project.rentalEndDate != null ? new Date(project.rentalEndDate) : null,
    project.id,
  );

  const result: Record<string, {
    overBy: number;
    totalStock: number;
    effectiveStock?: number;
    totalBooked: number;
    inherited?: boolean;
    unavailableAssets?: number;
    reducedOnly?: boolean;
    hasOverbookedChildren?: boolean;
    hasReducedChildren?: boolean;
  }> = {};

  for (const [id, info] of overbookedMap) {
    result[id] = info;
  }

  return serialize(result);
}
