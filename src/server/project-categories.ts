"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { projectCategorySchema, type ProjectCategoryFormValues } from "@/lib/validations/project-category";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { computeOverbookedStatus } from "@/lib/availability";

export async function getProjectCategories(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const lineItemInclude = {
    model: true,
    asset: true,
    bulkAsset: true,
    kit: true,
    supplier: { select: { name: true } },
    childLineItems: {
      include: {
        model: true,
        asset: true,
        bulkAsset: true,
        kit: true,
        supplier: { select: { name: true } },
      },
      orderBy: { sortOrder: "asc" as const },
    },
  };

  const categories = await prisma.projectCategory.findMany({
    where: { projectId, organizationId },
    include: {
      groups: {
        include: {
          lineItems: {
            include: lineItemInclude,
            orderBy: { sortOrder: "asc" },
          },
          slot: true,
        },
        orderBy: { sortOrder: "asc" },
      },
      // Sub-hire groups placed in this category (Phase 5b — cross-type
      // unification). Returned alongside ProjectGroups so the equipment
      // tab can render a unified ordered list per category. Includes the
      // sub-hire shell (PO / supplier metadata) so each row can show
      // "via Supplier" without an extra query.
      subHireGroupTargets: {
        include: {
          slot: true,
          subHire: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              supplier: { select: { id: true, name: true } },
            },
          },
          items: true,
          lineItems: {
            where: { isKitChild: false, parentLineItemId: null },
            include: lineItemInclude,
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      lineItems: {
        where: { groupId: null },
        include: lineItemInclude,
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  // Build the canonical mixed-ordered group list per category. Cross-type
  // sortOrder lives on CategorySlot; legacy groups without a slot row fall
  // back to their own per-table sortOrder so existing projects keep working.
  const withMixed = categories.map((cat) => {
    type MixedSlot =
      | { kind: "project"; sortOrder: number; projectGroupId: string }
      | { kind: "subHire"; sortOrder: number; subHireGroupId: string };

    const mixedGroups: MixedSlot[] = [
      ...cat.groups.map((g) => ({
        kind: "project" as const,
        sortOrder: g.slot?.sortOrder ?? g.sortOrder,
        projectGroupId: g.id,
      })),
      ...cat.subHireGroupTargets.map((g) => ({
        kind: "subHire" as const,
        sortOrder: g.slot?.sortOrder ?? g.sortOrder,
        subHireGroupId: g.id,
      })),
    ].sort((a, b) => a.sortOrder - b.sortOrder);

    return { ...cat, mixedGroups };
  });

  return serialize(withMixed);
}

export async function createProjectCategory(
  projectId: string,
  data: ProjectCategoryFormValues
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = projectCategorySchema.parse(data);

  // Get next sort order
  const maxSort = await prisma.projectCategory.aggregate({
    where: { projectId, organizationId },
    _max: { sortOrder: true },
  });

  const category = await prisma.projectCategory.create({
    data: {
      organizationId,
      projectId,
      name: parsed.name,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
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

  return serialize(category);
}

export async function updateProjectCategory(
  categoryId: string,
  data: Partial<ProjectCategoryFormValues>
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const category = await prisma.projectCategory.update({
    where: { id: categoryId, organizationId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.sortOrder !== undefined && { sortOrder: Number(data.sortOrder) }),
    },
  });

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

  return serialize(category);
}

export async function deleteProjectCategory(categoryId: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const category = await prisma.projectCategory.findUniqueOrThrow({
    where: { id: categoryId, organizationId },
    include: {
      groups: { include: { lineItems: true } },
      lineItems: { where: { groupId: null } },
    },
  });

  // Cascade: move all line items (from groups and standalone) to uncategorized
  const allLineItemIds = [
    ...category.groups.flatMap((g) => g.lineItems.map((li) => li.id)),
    ...category.lineItems.map((li) => li.id),
  ];

  await prisma.$transaction([
    // Unset category and group on all line items
    ...(allLineItemIds.length > 0
      ? [
          prisma.projectLineItem.updateMany({
            where: { id: { in: allLineItemIds } },
            data: { categoryId: null, groupId: null },
          }),
        ]
      : []),
    // Delete groups (cascade handles the FK)
    prisma.projectGroup.deleteMany({
      where: { categoryId, organizationId },
    }),
    // Delete category
    prisma.projectCategory.delete({
      where: { id: categoryId, organizationId },
    }),
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "project",
    entityId: category.projectId,
    entityName: category.name,
    summary: `Deleted category "${category.name}" — ${allLineItemIds.length} items moved to uncategorized`,
  });

  return serialize({ success: true });
}

export async function getUncategorizedLineItems(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const items = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      organizationId,
      categoryId: null,
      groupId: null,
    },
    include: {
      model: true,
      asset: true,
      bulkAsset: true,
      kit: true,
      supplier: { select: { name: true } },
      childLineItems: {
        include: {
          model: true,
          asset: true,
          bulkAsset: true,
          kit: true,
          supplier: { select: { name: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
  return serialize(items);
}

export async function reorderProjectCategories(
  projectId: string,
  orderedIds: string[]
) {
  const { organizationId } = await requirePermission("project", "manage_line_items");

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.projectCategory.update({
        where: { id, organizationId },
        data: { sortOrder: index },
      })
    )
  );

  return serialize({ success: true });
}

/**
 * Returns a map of lineItemId → overbookedInfo for all line items in a project.
 * Used by the equipment tab to show overbooked/reduced stock badges.
 */
export async function getProjectOverbookedStatus(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");

  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      rentalStartDate: true,
      rentalEndDate: true,
      lineItems: {
        where: { status: { not: "CANCELLED" } },
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
      },
    },
  });

  if (!project) return serialize({});

  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    project.lineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id,
  );

  // Convert Map to plain object for serialization
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
