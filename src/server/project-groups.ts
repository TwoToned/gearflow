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
import {
  mirrorProjectGroupCreate,
  removeProjectGroupFromConvex,
  syncProjectGroupsToConvex,
} from "@/lib/project-grouping-mirror";
import { roundCurrency } from "@/lib/formatters";
import { recalculateProjectTotals } from "./line-items";
import { optimizePrice, computeTotalDays } from "@/lib/pricing";
import { getOrgDaysPerMonth } from "@/lib/org-pricing";

/**
 * Get the billing period for a group, falling back to project-level settings.
 * Returns {months, weeks, days} if any billing fields are set, or null for legacy mode.
 */
export async function getGroupBillingPeriod(groupId: string): Promise<{
  months: number;
  weeks: number;
  days: number;
  totalDays: number;
} | null> {
  const group = await prisma.projectGroup.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      project: {
        select: {
          billingMonths: true,
          billingWeeks: true,
          billingDays: true,
        },
      },
    },
  });

  const months = group.billingMonths ?? group.project.billingMonths ?? 0;
  const weeks = group.billingWeeks ?? group.project.billingWeeks ?? 0;
  const days = group.billingDays ?? group.project.billingDays ?? 0;

  // Check if any billing fields are set at group or project level
  const hasGroupBilling = group.billingMonths != null || group.billingWeeks != null || group.billingDays != null;
  const hasProjectBilling = group.project.billingMonths != null || group.project.billingWeeks != null || group.project.billingDays != null;

  if (!hasGroupBilling && !hasProjectBilling) return null;

  const daysPerMonth = await getOrgDaysPerMonth(group.organizationId);
  const totalDays = computeTotalDays(months, weeks, days, daysPerMonth);
  return { months, weeks, days, totalDays };
}

/**
 * Calculate the suggested price for a group based on its line items' rates.
 *
 * Uses the pricing optimizer when months/weeks/days billing fields are set.
 * Falls back to the old rentalPeriod/rentalQuantity model otherwise.
 */
export async function calculateSuggestedPrice(groupId: string): Promise<number> {
  const group = await prisma.projectGroup.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      project: {
        select: {
          defaultRentalPeriod: true,
          defaultRentalQuantity: true,
          billingMonths: true,
          billingWeeks: true,
          billingDays: true,
        },
      },
      lineItems: {
        include: { model: { select: { dailyRate: true, weeklyRate: true, monthlyRate: true } } },
        where: { isKitChild: false },
      },
    },
  });

  const months = group.billingMonths ?? group.project.billingMonths ?? 0;
  const weeks = group.billingWeeks ?? group.project.billingWeeks ?? 0;
  const days = group.billingDays ?? group.project.billingDays ?? 0;
  const hasNewBilling = (group.billingMonths ?? group.project.billingMonths) != null
    || (group.billingWeeks ?? group.project.billingWeeks) != null
    || (group.billingDays ?? group.project.billingDays) != null;

  let total = 0;

  // Custom items intentionally excluded: the suggested price covers the
  // *equipment bundle* only. Custom items are always counted as extras on
  // top via `recalculateProjectTotals` (customExtras). Including them here
  // double-counts when the user clicks Accept Suggested Price — the
  // suggestion becomes `g.price`, and the extras get added again.
  if (hasNewBilling) {
    const daysPerMonth = await getOrgDaysPerMonth(group.organizationId);
    const totalDays = computeTotalDays(months, weeks, days, daysPerMonth);
    for (const item of group.lineItems) {
      if (item.isCustomItem) continue;

      const dailyRate = item.model?.dailyRate != null ? Number(item.model.dailyRate) : null;
      const weeklyRate = item.model?.weeklyRate != null ? Number(item.model.weeklyRate) : null;
      const monthlyRate = item.model?.monthlyRate != null ? Number(item.model.monthlyRate) : null;

      const result = optimizePrice(dailyRate, weeklyRate, monthlyRate, totalDays, daysPerMonth);
      if (result) {
        total += result.grandTotal * item.quantity;
      }
    }
  } else {
    // Legacy fallback
    const rentalPeriod = group.rentalPeriod ?? group.project.defaultRentalPeriod ?? "DAILY";
    const rentalQuantity = group.rentalQuantity ?? group.project.defaultRentalQuantity ?? 1;
    for (const item of group.lineItems) {
      if (item.isCustomItem) continue;

      const rate =
        rentalPeriod === "WEEKLY"
          ? Number(item.model?.weeklyRate ?? item.model?.dailyRate ?? item.unitPrice ?? 0)
          : Number(item.model?.dailyRate ?? item.unitPrice ?? 0);
      total += rate * item.quantity * rentalQuantity;
    }
  }

  return roundCurrency(total);
}

/**
 * Recalculate optimized prices for all non-overridden line items in a group.
 * Kit-aware: skips kit children in KIT_PRICE mode, includes them in ITEMIZED mode.
 * Returns the count of items updated.
 */
export async function recalculateGroupPrices(groupId: string): Promise<number> {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const billingPeriod = await getGroupBillingPeriod(groupId);
  if (!billingPeriod) return 0;

  const group = await prisma.projectGroup.findUniqueOrThrow({
    where: { id: groupId, organizationId },
    include: {
      lineItems: {
        where: { priceOverridden: false },
        include: {
          model: { select: { dailyRate: true, weeklyRate: true, monthlyRate: true } },
          parentLineItem: { select: { pricingMode: true } },
        },
      },
    },
  });

  const updates: Array<ReturnType<typeof prisma.projectLineItem.update>> = [];
  const daysPerMonth = await getOrgDaysPerMonth(organizationId);

  for (const item of group.lineItems) {
    // Skip kit children when parent uses KIT_PRICE mode
    if (item.isKitChild && item.parentLineItem?.pricingMode === "KIT_PRICE") continue;

    if (!item.model) continue;

    const dailyRate = item.model.dailyRate != null ? Number(item.model.dailyRate) : null;
    const weeklyRate = item.model.weeklyRate != null ? Number(item.model.weeklyRate) : null;
    const monthlyRate = item.model.monthlyRate != null ? Number(item.model.monthlyRate) : null;

    const result = optimizePrice(dailyRate, weeklyRate, monthlyRate, billingPeriod.totalDays, daysPerMonth);
    if (!result) continue;

    updates.push(
      prisma.projectLineItem.update({
        where: { id: item.id },
        data: {
          unitPrice: result.grandTotal,
          pricingType: "OPTIMIZED",
          duration: 1,
          priceBreakdown: result.breakdown,
          priceOverridden: false,
          lineTotal: roundCurrency(result.grandTotal * item.quantity),
        },
      })
    );
  }

  if (updates.length === 0) return 0;

  await prisma.$transaction(updates);

  // Recalculate suggested price and project totals
  const suggested = await calculateSuggestedPrice(groupId);
  await prisma.projectGroup.update({
    where: { id: groupId },
    data: { suggestedPrice: suggested },
  });
  await syncProjectGroupsToConvex([groupId]);

  await recalculateProjectTotals(group.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: group.projectId,
    entityName: group.title,
    summary: `Recalculated prices for ${updates.length} item(s) in group "${group.title}"`,
  });

  return updates.length;
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
      billingMonths: parsed.billingMonths ?? null,
      billingWeeks: parsed.billingWeeks ?? null,
      billingDays: parsed.billingDays ?? null,
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
      ...(data.billingMonths !== undefined && { billingMonths: data.billingMonths != null ? Number(data.billingMonths) : null }),
      ...(data.billingWeeks !== undefined && { billingWeeks: data.billingWeeks != null ? Number(data.billingWeeks) : null }),
      ...(data.billingDays !== undefined && { billingDays: data.billingDays != null ? Number(data.billingDays) : null }),
      ...(data.sortOrder !== undefined && { sortOrder: Number(data.sortOrder) }),
    },
  });

  // Recalculate suggestion if billing/rental settings changed
  if (data.rentalPeriod !== undefined || data.rentalQuantity !== undefined || data.billingMonths !== undefined || data.billingWeeks !== undefined || data.billingDays !== undefined) {
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
  // The line-item move itself is mirrored in the line_item domain (step 4); here
  // we mirror only the affected groups' suggestedPrice recalcs.
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
