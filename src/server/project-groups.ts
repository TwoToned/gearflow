"use server";

import { createId } from "@paralleldrive/cuid2";
import { requirePermission } from "@/lib/org-context";
import {
  projectGroupSchema,
  updateGroupPriceSchema,
  moveLineItemSchema,
  moveLineItemsSchema,
  type ProjectGroupFormValues,
} from "@/lib/validations/project-group";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { writeCollabActivityEvent } from "@/lib/collaboration-activity";
import { mapLineItemDoc } from "@/lib/project-line-item-read";
import { roundCurrency } from "@/lib/formatters";
import { recalculateProjectTotals } from "./line-items";
import { getModelMap } from "@/lib/models-read";
import { getProjectByIdMapped } from "@/lib/projects-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Calculate the suggested price for a group based on its line items' rates.
 *
 * Uses the simple `rate × quantity × rentalQuantity` model from the group's
 * (or project's) default rental period/quantity.
 */
export async function calculateSuggestedPrice(groupId: string): Promise<number> {
  const client = await getConvexClient();
  const group = await client.query(api.projectGroups.getById, { id: groupId });
  if (!group) return 0;

  // project is Convex-only — read the scalars (org-scoped via the group's org).
  const project = await getProjectByIdMapped(group.projectId, group.organizationId);

  const allLineItems = await client.query(api.projectLineItems.listByProject, {
    projectId: group.projectId,
    orgId: group.organizationId,
  });
  const lineItems = allLineItems
    .map(mapLineItemDoc)
    .filter((li) => li.groupId === groupId && !li.isKitChild);

  let total = 0;
  const modelMap = await getModelMap(group.organizationId);

  // Custom items intentionally excluded: the suggested price covers the
  // *equipment bundle* only.
  const rentalPeriod = group.rentalPeriod ?? project?.defaultRentalPeriod ?? "DAILY";
  const rentalQuantity = group.rentalQuantity ?? project?.defaultRentalQuantity ?? 1;
  for (const item of lineItems) {
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
  const client = await getConvexClient();

  // Atomic create-at-end within the (project, category) bucket — sortOrder
  // computed inside the mutation (no read-max-then-insert TOCTOU).
  const id = createId();
  const now = Date.now();
  const { sortOrder } = await client.mutation(api.projectGroups.createAtEnd, {
    id,
    organizationId,
    projectId,
    categoryId: parsed.categoryId || undefined,
    title: parsed.title,
    description: parsed.description || undefined,
    quantity: parsed.quantity,
    price: parsed.price != null ? parsed.price : undefined,
    rentalPeriod: parsed.rentalPeriod || undefined,
    rentalQuantity: parsed.rentalQuantity || undefined,
    suggestedPrice: 0,
    now,
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

  return serialize({
    id,
    organizationId,
    projectId,
    categoryId: parsed.categoryId ?? null,
    title: parsed.title,
    description: parsed.description || null,
    quantity: parsed.quantity,
    price: parsed.price != null ? parsed.price : null,
    rentalPeriod: parsed.rentalPeriod || null,
    rentalQuantity: parsed.rentalQuantity || null,
    sortOrder,
    suggestedPrice: 0,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
}

export async function updateProjectGroup(
  groupId: string,
  data: Partial<ProjectGroupFormValues>
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  const group = await client.query(api.projectGroups.getById, { id: groupId });
  if (!group || group.organizationId !== organizationId) {
    throw new Error("Group not found");
  }

  const now = Date.now();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description || undefined;
  if (data.quantity !== undefined) patch.quantity = Number(data.quantity);
  if (data.rentalPeriod !== undefined) patch.rentalPeriod = data.rentalPeriod || undefined;
  if (data.rentalQuantity !== undefined) patch.rentalQuantity = data.rentalQuantity ? Number(data.rentalQuantity) : undefined;
  if (data.sortOrder !== undefined) patch.sortOrder = Number(data.sortOrder);

  await client.mutation(api.projectGroups.update, { id: groupId, patch });

  // Recalculate suggestion if rental settings changed
  if (data.rentalPeriod !== undefined || data.rentalQuantity !== undefined) {
    const suggested = await calculateSuggestedPrice(groupId);
    await client.mutation(api.projectGroups.update, {
      id: groupId,
      patch: { suggestedPrice: suggested, updatedAt: Date.now() },
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
        targetId: groupId,
      },
    );
  }

  const updated = await client.query(api.projectGroups.getById, { id: groupId });
  return serialize({
    ...(updated ?? group),
    price: (updated ?? group).price ?? null,
    suggestedPrice: (updated ?? group).suggestedPrice ?? null,
    rentalPeriod: (updated ?? group).rentalPeriod ?? null,
    rentalQuantity: (updated ?? group).rentalQuantity ?? null,
    createdAt: new Date((updated ?? group).createdAt ?? 0),
    updatedAt: new Date((updated ?? group).updatedAt ?? now),
  });
}

export async function updateGroupPrice(groupId: string, price: number) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  updateGroupPriceSchema.parse({ price });
  const client = await getConvexClient();

  const group = await client.query(api.projectGroups.getById, { id: groupId });
  if (!group || group.organizationId !== organizationId) {
    throw new Error("Group not found");
  }

  const now = Date.now();
  await client.mutation(api.projectGroups.update, {
    id: groupId,
    patch: { price, updatedAt: now },
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

  return serialize({
    ...group,
    price,
    suggestedPrice: group.suggestedPrice ?? null,
    rentalPeriod: group.rentalPeriod ?? null,
    rentalQuantity: group.rentalQuantity ?? null,
    createdAt: new Date(group.createdAt ?? 0),
    updatedAt: new Date(now),
  });
}

export async function acceptSuggestedPrice(groupId: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  const group = await client.query(api.projectGroups.getById, { id: groupId });
  if (!group || group.organizationId !== organizationId) {
    throw new Error("Group not found");
  }

  const suggested = await calculateSuggestedPrice(groupId);

  const now = Date.now();
  await client.mutation(api.projectGroups.update, {
    id: groupId,
    patch: { price: suggested, suggestedPrice: suggested, updatedAt: now },
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
  const client = await getConvexClient();

  const allGroups = await client.query(api.projectGroups.listByProject, { projectId, orgId: organizationId });
  const groups = categoryId
    ? allGroups.filter((g) => g.categoryId === categoryId)
    : allGroups;

  let count = 0;
  for (const group of groups) {
    const suggested = await calculateSuggestedPrice(group.id);
    if (suggested > 0) {
      await client.mutation(api.projectGroups.update, {
        id: group.id,
        patch: { price: suggested, suggestedPrice: suggested, updatedAt: Date.now() },
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
  const client = await getConvexClient();

  const group = await client.query(api.projectGroups.getById, { id: groupId });
  if (!group || group.organizationId !== organizationId) {
    throw new Error("Group not found");
  }

  // Line items in this group (Convex), for the log count + cascade null-out.
  const allLineItems = await client.query(api.projectLineItems.listByProject, {
    projectId: group.projectId,
    orgId: organizationId,
  });
  const lineItems = allLineItems.filter((li) => li.groupId === groupId);

  // Cascade: move line items to standalone in same category (clear groupId only).
  const nowClear = Date.now();
  for (const li of lineItems) {
    await client.mutation(api.projectLineItems.patchLineItem, {
      id: li.id,
      set: { updatedAt: nowClear },
      clear: ["groupId"],
    });
  }

  // Atomic Convex cascade: the group's slots + the group itself, one transaction.
  await client.mutation(api.projectGroups.deleteCascade, { groupId });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "deleted",
    entityType: "project",
    entityId: group.projectId,
    entityName: group.title,
    summary: `Deleted group "${group.title}" — ${lineItems.length} items moved to standalone`,
  });

  await recalculateProjectTotals(group.projectId);

  return serialize({ success: true });
}

export async function moveLineItemToGroup(
  data: { lineItemId: string; targetGroupId: string | null; targetCategoryId: string | null }
) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = moveLineItemSchema.parse(data);

  const client = await getConvexClient();

  const lineItem = await client.query(api.projectLineItems.getById, { id: parsed.lineItemId });
  if (!lineItem || lineItem.organizationId !== organizationId) {
    throw new Error("Line item not found");
  }

  const oldGroupId = lineItem.groupId ?? null;

  // Apply the move on the line item (Convex): groupId + categoryId, null → clear.
  const moveSet: Record<string, unknown> = { updatedAt: Date.now() };
  const moveClear: string[] = [];
  if (parsed.targetGroupId != null) moveSet.groupId = parsed.targetGroupId;
  else moveClear.push("groupId");
  if (parsed.targetCategoryId != null) moveSet.categoryId = parsed.targetCategoryId;
  else moveClear.push("categoryId");
  await client.mutation(api.projectLineItems.patchLineItem, {
    id: parsed.lineItemId,
    set: moveSet,
    clear: moveClear,
  });

  // If this line item is derived from a sub-hire, persist the placement back to
  // the originating sub-hire entity's target* fields. generateSubHireLineItems
  // deletes + recreates every sub-hire line on the next add/edit and resolves
  // placement ONLY from the sub-hire entity's target*/order-default — it never
  // reads the projectLineItem's own groupId/categoryId. Without this write-back
  // the manual move is silently reverted and the item "pops out" of the
  // group/category the user placed it in (mirrors moveSubHireGroupToCategory,
  // which already writes targetCategoryId back to the sub-hire group).
  const subHireGroupId = lineItem.subHireGroupId ?? null;
  const subHireItemId = lineItem.subHireItemId ?? null;
  if (subHireGroupId || subHireItemId) {
    const targetSet: Record<string, unknown> = {};
    const targetClear: string[] = [];
    if (parsed.targetGroupId != null) targetSet.targetGroupId = parsed.targetGroupId;
    else targetClear.push("targetGroupId");
    if (parsed.targetCategoryId != null) targetSet.targetCategoryId = parsed.targetCategoryId;
    else targetClear.push("targetCategoryId");
    if (subHireGroupId) {
      await client.mutation(api.subHireGroups.patchGroup, {
        id: subHireGroupId,
        set: targetSet,
        clear: targetClear,
      });
    } else if (subHireItemId) {
      await client.mutation(api.subHireItems.patchItem, {
        id: subHireItemId,
        set: targetSet,
        clear: targetClear,
      });
    }
  }

  // Recalculate suggestions for both old and new groups in Convex
  const now = Date.now();
  if (oldGroupId) {
    const suggested = await calculateSuggestedPrice(oldGroupId);
    await client.mutation(api.projectGroups.update, {
      id: oldGroupId,
      patch: { suggestedPrice: suggested, updatedAt: now },
    });
  }
  if (parsed.targetGroupId) {
    const suggested = await calculateSuggestedPrice(parsed.targetGroupId);
    await client.mutation(api.projectGroups.update, {
      id: parsed.targetGroupId,
      patch: { suggestedPrice: suggested, updatedAt: now },
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

/**
 * Bulk variant of {@link moveLineItemToGroup}: move many line items to the same
 * destination group/category in one server round-trip. Loops the legacy patch
 * mutation server-side, then recomputes suggested prices for every affected group
 * (all distinct source groups + the destination) and recalcs each affected
 * project ONCE. Child items are skipped and reported in `skipped`.
 */
export async function moveLineItemsToGroup(data: {
  lineItemIds: string[];
  targetGroupId: string | null;
  targetCategoryId: string | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = moveLineItemsSchema.parse(data);

  const client = await getConvexClient();
  const now = Date.now();
  const affectedGroupIds = new Set<string>();
  const affectedProjectIds = new Set<string>();
  let moved = 0;
  let skipped = 0;

  const items = await Promise.all(
    parsed.lineItemIds.map((id) => client.query(api.projectLineItems.getById, { id })),
  );

  for (const lineItem of items) {
    if (!lineItem || lineItem.organizationId !== organizationId) {
      skipped++;
      continue;
    }
    if (lineItem.isKitChild) {
      skipped++;
      continue;
    }
    if (lineItem.groupId) affectedGroupIds.add(lineItem.groupId);

    const moveSet: Record<string, unknown> = { updatedAt: now };
    const moveClear: string[] = [];
    if (parsed.targetGroupId != null) moveSet.groupId = parsed.targetGroupId;
    else moveClear.push("groupId");
    if (parsed.targetCategoryId != null) moveSet.categoryId = parsed.targetCategoryId;
    else moveClear.push("categoryId");

    await client.mutation(api.projectLineItems.patchLineItem, {
      id: lineItem.id,
      set: moveSet,
      clear: moveClear,
    });
    affectedProjectIds.add(lineItem.projectId);
    moved++;
  }

  if (parsed.targetGroupId) affectedGroupIds.add(parsed.targetGroupId);

  // Refresh suggested prices for every touched group (sources + destination).
  for (const gid of affectedGroupIds) {
    const suggested = await calculateSuggestedPrice(gid);
    await client.mutation(api.projectGroups.update, {
      id: gid,
      patch: { suggestedPrice: suggested, updatedAt: now },
    });
  }

  await Promise.all(
    [...affectedProjectIds].map((pid) => recalculateProjectTotals(pid)),
  );

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: [...affectedProjectIds][0] ?? parsed.lineItemIds[0],
    entityName: `${moved} line item${moved === 1 ? "" : "s"}`,
    summary: `Moved ${moved} line item${moved === 1 ? "" : "s"} to ${
      parsed.targetGroupId ? "group" : "standalone"
    }`,
  });

  return serialize({ moved, skipped });
}

export async function reorderProjectGroups(
  categoryId: string,
  orderedIds: string[]
) {
  await requirePermission("project", "manage_line_items");
  const client = await getConvexClient();

  // Atomic reorder within the category: contiguous sortOrder in one transaction.
  await client.mutation(api.projectGroups.reorder, { orderedIds, now: Date.now() });

  return serialize({ success: true });
}
