"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import {
  projectGroupSchema,
  updateGroupPriceSchema,
  moveLineItemSchema,
  type ProjectGroupFormValues,
} from "@/lib/validations/project-group";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { writeCollabActivityEvent } from "@/lib/collaboration-activity";
import {
  mirrorProjectGroupCreate,
  removeProjectGroupFromConvex,
  syncProjectGroupsToConvex,
} from "@/lib/project-grouping-mirror";
import { syncLineItemsToConvex } from "@/lib/line-item-mirror";
import { roundCurrency } from "@/lib/formatters";
import { recalculateProjectTotals } from "./line-items";
import { getModelMap } from "@/lib/models-read";

/**
 * Calculate the suggested price for a group based on its line items' rates.
 *
 * Uses the simple `rate × quantity × rentalQuantity` model from the group's
 * (or project's) default rental period/quantity.
 */
export async function calculateSuggestedPrice(groupId: string): Promise<number> {
  const group = await prisma.projectGroup.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      project: {
        select: {
          defaultRentalPeriod: true,
          defaultRentalQuantity: true,
        },
      },
      lineItems: {
        where: { isKitChild: false },
      },
    },
  });

  let total = 0;
  const modelMap = await getModelMap(group.organizationId);

  // Custom items intentionally excluded: the suggested price covers the
  // *equipment bundle* only. Custom items are always counted as extras on
  // top via `recalculateProjectTotals` (customExtras). Including them here
  // double-counts when the user clicks Accept Suggested Price — the
  // suggestion becomes `g.price`, and the extras get added again.
  const rentalPeriod = group.rentalPeriod ?? group.project.defaultRentalPeriod ?? "DAILY";
  const rentalQuantity = group.rentalQuantity ?? group.project.defaultRentalQuantity ?? 1;
  for (const item of group.lineItems) {
    if (item.isCustomItem) continue;
    const model = item.modelId ? modelMap.get(item.modelId) ?? null : null;

    const rate =
      rentalPeriod === "WEEKLY"
        ? Number(model?.weeklyRate ?? model?.dailyRate ?? item.unitPrice ?? 0)
        : Number(model?.dailyRate ?? item.unitPrice ?? 0);
    total += rate * item.quantity * rentalQuantity;
  }

  return roundCurrency(total);
}

export async function createProjectGroup(
  projectId: string,
  data: ProjectGroupFormValues
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = projectGroupSchema.parse(data);

  // Get next sort order within the (project, category) bucket.
  // Scoping by projectId matters when categoryId is null — without
  // it, orphan groups from other projects in the same org would
  // share the same null sortOrder pool. With it, each project's
  // Uncategorized zone has its own independent sequence.
  const maxSort = await prisma.projectGroup.aggregate({
    where: { categoryId: parsed.categoryId, projectId, organizationId },
    _max: { sortOrder: true },
  });

  const group = await prisma.projectGroup.create({
    data: {
      organizationId,
      projectId,
      categoryId: parsed.categoryId,
      title: parsed.title,
      description: parsed.description || null,
      quantity: parsed.quantity,
      price: parsed.price != null ? parsed.price : null,
      rentalPeriod: parsed.rentalPeriod || null,
      rentalQuantity: parsed.rentalQuantity || null,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      suggestedPrice: 0,
    },
  });
  await mirrorProjectGroupCreate(group);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "project",
    entityId: projectId,
    entityName: parsed.title,
    summary: `Created group "${parsed.title}"`,
  });

  return serialize(group);
}

export async function updateProjectGroup(
  groupId: string,
  data: Partial<ProjectGroupFormValues>
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const group = await prisma.projectGroup.update({
    where: { id: groupId, organizationId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description || null }),
      ...(data.quantity !== undefined && { quantity: Number(data.quantity) }),
      ...(data.rentalPeriod !== undefined && { rentalPeriod: data.rentalPeriod || null }),
      ...(data.rentalQuantity !== undefined && { rentalQuantity: data.rentalQuantity ? Number(data.rentalQuantity) : null }),
      ...(data.sortOrder !== undefined && { sortOrder: Number(data.sortOrder) }),
    },
  });

  // Recalculate suggestion if rental settings changed
  if (data.rentalPeriod !== undefined || data.rentalQuantity !== undefined) {
    const suggested = await calculateSuggestedPrice(groupId);
    await prisma.projectGroup.update({
      where: { id: groupId },
      data: { suggestedPrice: suggested },
    });
  }
  await syncProjectGroupsToConvex([groupId]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: group.projectId,
    entityName: group.title,
    summary: `Updated group "${group.title}"`,
  });

  await recalculateProjectTotals(group.projectId);

  // Realtime collaboration feed — skip pure drag-reorders (sortOrder only).
  if (Object.keys(data).some((k) => k !== "sortOrder")) {
    await writeCollabActivityEvent(
      { organizationId, userId, userName },
      {
        entityType: "project",
        entityId: group.projectId,
        action: "group_updated",
        summary: `updated group "${group.title}"`,
        targetType: "group",
        targetId: group.id,
      },
    );
  }

  return serialize(group);
}

export async function updateGroupPrice(groupId: string, price: number) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  updateGroupPriceSchema.parse({ price });

  const group = await prisma.projectGroup.update({
    where: { id: groupId, organizationId },
    data: { price },
  });
  await syncProjectGroupsToConvex([groupId]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: group.projectId,
    entityName: group.title,
    summary: `Set price on group "${group.title}" to $${price.toFixed(2)}`,
  });

  await recalculateProjectTotals(group.projectId);

  return serialize(group);
}

export async function acceptSuggestedPrice(groupId: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const group = await prisma.projectGroup.findUniqueOrThrow({
    where: { id: groupId, organizationId },
  });

  const suggested = await calculateSuggestedPrice(groupId);

  await prisma.projectGroup.update({
    where: { id: groupId },
    data: { price: suggested, suggestedPrice: suggested },
  });
  await syncProjectGroupsToConvex([groupId]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: group.projectId,
    entityName: group.title,
    summary: `Accepted suggested price $${suggested.toFixed(2)} for group "${group.title}"`,
  });

  await recalculateProjectTotals(group.projectId);

  return serialize({ price: suggested });
}

export async function acceptAllSuggestedPrices(
  projectId: string,
  categoryId?: string
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const where: { projectId: string; organizationId: string; categoryId?: string } = {
    projectId,
    organizationId,
  };
  if (categoryId) where.categoryId = categoryId;

  const groups = await prisma.projectGroup.findMany({ where });

  let count = 0;
  for (const group of groups) {
    const suggested = await calculateSuggestedPrice(group.id);
    if (suggested > 0) {
      await prisma.projectGroup.update({
        where: { id: group.id },
        data: { price: suggested, suggestedPrice: suggested },
      });
      count++;
    }
  }
  await syncProjectGroupsToConvex(groups.map((g) => g.id));

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: projectId,
    entityName: "Batch pricing",
    summary: `Accepted suggested prices for ${count} group(s)`,
  });

  await recalculateProjectTotals(projectId);

  return serialize({ count });
}

export async function deleteProjectGroup(groupId: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const group = await prisma.projectGroup.findUniqueOrThrow({
    where: { id: groupId, organizationId },
    include: { lineItems: true },
  });

  // Cascade: move line items to standalone in same category
  await prisma.$transaction([
    prisma.projectLineItem.updateMany({
      where: { groupId, organizationId },
      data: { groupId: null },
    }),
    prisma.projectGroup.delete({
      where: { id: groupId, organizationId },
    }),
  ]);
  await removeProjectGroupFromConvex(groupId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "project",
    entityId: group.projectId,
    entityName: group.title,
    summary: `Deleted group "${group.title}" — ${group.lineItems.length} items moved to standalone`,
  });

  await recalculateProjectTotals(group.projectId);

  return serialize({ success: true });
}

export async function moveLineItemToGroup(
  data: { lineItemId: string; targetGroupId: string | null; targetCategoryId: string | null }
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = moveLineItemSchema.parse(data);

  const lineItem = await prisma.projectLineItem.findUniqueOrThrow({
    where: { id: parsed.lineItemId, organizationId },
  });

  const oldGroupId = lineItem.groupId;

  await prisma.projectLineItem.update({
    where: { id: parsed.lineItemId },
    data: {
      groupId: parsed.targetGroupId,
      categoryId: parsed.targetCategoryId,
    },
  });

  // Recalculate suggestions for both old and new groups
  if (oldGroupId) {
    const suggested = await calculateSuggestedPrice(oldGroupId);
    await prisma.projectGroup.update({
      where: { id: oldGroupId },
      data: { suggestedPrice: suggested },
    });
  }
  if (parsed.targetGroupId) {
    const suggested = await calculateSuggestedPrice(parsed.targetGroupId);
    await prisma.projectGroup.update({
      where: { id: parsed.targetGroupId },
      data: { suggestedPrice: suggested },
    });
  }
  // Mirror the moved line item's new groupId/categoryId + the affected groups'
  // suggestedPrice recalcs. (Move to standalone clears groupId→null — the
  // documented clear-to-null no-op in Convex.)
  await syncLineItemsToConvex([parsed.lineItemId]);
  await syncProjectGroupsToConvex([oldGroupId, parsed.targetGroupId]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: lineItem.projectId,
    entityName: lineItem.description ?? "Line item",
    summary: `Moved line item to ${parsed.targetGroupId ? "group" : "standalone"}`,
  });

  await recalculateProjectTotals(lineItem.projectId);

  return serialize({ success: true });
}

export async function reorderProjectGroups(
  categoryId: string,
  orderedIds: string[]
) {
  const { organizationId } = await requirePermission("project", "manage_line_items");

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.projectGroup.update({
        where: { id, organizationId },
        data: { sortOrder: index },
      })
    )
  );
  await syncProjectGroupsToConvex(orderedIds);

  return serialize({ success: true });
}
