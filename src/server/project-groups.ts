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
import { roundCurrency } from "@/lib/formatters";
import { recalculateProjectTotals } from "./line-items";

/**
 * Calculate the suggested price for a group based on its line items' rates.
 *
 * Billing model: the project (or group override) specifies how many weeks and
 * days the gig spans for billing purposes. The suggested price is:
 *
 *   SUM( (weeklyRate × weeks) + (dailyRate × days) ) × item.quantity
 *
 * Falls back to the old rentalPeriod/rentalQuantity model if billingWeeks/billingDays
 * are not set.
 */
export async function calculateSuggestedPrice(groupId: string): Promise<number> {
  const group = await prisma.projectGroup.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      project: {
        select: {
          defaultRentalPeriod: true,
          defaultRentalQuantity: true,
          billingWeeks: true,
          billingDays: true,
        },
      },
      lineItems: {
        include: { model: true },
        where: { isKitChild: false },
      },
    },
  });

  // Prefer weeks+days billing model, fall back to legacy rentalPeriod/rentalQuantity
  const weeks = group.billingWeeks ?? group.project.billingWeeks;
  const days = group.billingDays ?? group.project.billingDays;
  const useWeeksDays = weeks != null || days != null;

  let total = 0;

  if (useWeeksDays) {
    const w = weeks ?? 0;
    const d = days ?? 0;
    for (const item of group.lineItems) {
      const weeklyRate = Number(item.model?.weeklyRate ?? 0);
      const dailyRate = Number(item.model?.dailyRate ?? item.unitPrice ?? 0);
      total += ((weeklyRate * w) + (dailyRate * d)) * item.quantity;
    }
  } else {
    // Legacy fallback
    const rentalPeriod = group.rentalPeriod ?? group.project.defaultRentalPeriod ?? "DAILY";
    const rentalQuantity = group.rentalQuantity ?? group.project.defaultRentalQuantity ?? 1;
    for (const item of group.lineItems) {
      const rate =
        rentalPeriod === "WEEKLY"
          ? Number(item.model?.weeklyRate ?? item.model?.dailyRate ?? item.unitPrice ?? 0)
          : Number(item.model?.dailyRate ?? item.unitPrice ?? 0);
      total += rate * item.quantity * rentalQuantity;
    }
  }

  return roundCurrency(total);
}

export async function createProjectGroup(
  projectId: string,
  data: ProjectGroupFormValues
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = projectGroupSchema.parse(data);

  // Get next sort order within category
  const maxSort = await prisma.projectGroup.aggregate({
    where: { categoryId: parsed.categoryId, organizationId },
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
      billingWeeks: parsed.billingWeeks ?? null,
      billingDays: parsed.billingDays ?? null,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      suggestedPrice: 0,
    },
  });

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
      ...(data.billingWeeks !== undefined && { billingWeeks: data.billingWeeks != null ? Number(data.billingWeeks) : null }),
      ...(data.billingDays !== undefined && { billingDays: data.billingDays != null ? Number(data.billingDays) : null }),
      ...(data.sortOrder !== undefined && { sortOrder: Number(data.sortOrder) }),
    },
  });

  // Recalculate suggestion if billing/rental settings changed
  if (data.rentalPeriod !== undefined || data.rentalQuantity !== undefined || data.billingWeeks !== undefined || data.billingDays !== undefined) {
    const suggested = await calculateSuggestedPrice(groupId);
    await prisma.projectGroup.update({
      where: { id: groupId },
      data: { suggestedPrice: suggested },
    });
  }

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

  return serialize(group);
}

export async function updateGroupPrice(groupId: string, price: number) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  updateGroupPriceSchema.parse({ price });

  const group = await prisma.projectGroup.update({
    where: { id: groupId, organizationId },
    data: { price },
  });

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

  return serialize({ success: true });
}
