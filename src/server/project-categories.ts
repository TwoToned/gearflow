"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { projectCategorySchema, type ProjectCategoryFormValues } from "@/lib/validations/project-category";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";

export async function getProjectCategories(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const categories = await prisma.projectCategory.findMany({
    where: { projectId, organizationId },
    include: {
      groups: {
        include: {
          lineItems: {
            include: {
              model: true,
              asset: true,
              bulkAsset: true,
              kit: true,
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      lineItems: {
        where: { groupId: null },
        include: {
          model: true,
          asset: true,
          bulkAsset: true,
          kit: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
  return serialize(categories);
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
