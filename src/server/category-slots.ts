"use server";

/**
 * Cross-type CategorySlot server actions (Phase 5a of cross-type group
 * unification). These actions own the ordering and category placement of
 * mixed ProjectGroup + SubHireGroup lists inside a ProjectCategory.
 *
 * Why a separate module?
 *
 * The existing per-table reorder/move actions don't see the unified shape:
 * ProjectGroup.sortOrder and SubHireGroup.sortOrder are per-table fields,
 * so they can't express "move sub-hire X above project-group Y in the
 * same category." CategorySlot owns the canonical cross-type sortOrder
 * and these actions are the only writers — keeping the invariant in one
 * place.
 *
 * What is NOT in this module:
 *
 *   - `moveLineItemToSubHireGroup` — explicitly absent per Drop Matrix 8C.
 *     Own-stock items can't enter a sub-hire group; if a future caller
 *     needs that, it's a feature request, not a bug.
 *
 *   - `moveSubHireGroupToCategory` does NOT trigger syncSubHireToProject
 *     (Finding 6.1). Placement is metadata; regenerating 30 line items
 *     per drag would be a perf disaster. recalculateProjectTotals is
 *     still called once so totals reflect any category-scoped surcharges.
 */

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { getProjectById } from "@/lib/projects-read";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { upsertProjectLineItemsToConvex } from "@/lib/line-item-mirror";
import {
  buildLineItemAttachMaps,
  attachLineItemTree,
  resolveAttachedSupplier,
} from "@/lib/line-item-tree-read";
import { syncSubHireToConvex } from "@/lib/sub-hire-mirror";
import { recalculateProjectTotals } from "@/server/line-items";
import {
  moveSubHireGroupToCategorySchema,
  moveProjectGroupToCategorySchema,
  reorderMixedGroupsInCategorySchema,
  createCategoryAndPlaceGroupSchema,
  parseSlotId,
  type MoveSubHireGroupToCategoryInput,
  type MoveProjectGroupToCategoryInput,
  type ReorderMixedGroupsInCategoryInput,
  type CreateCategoryAndPlaceGroupInput,
} from "@/lib/validations/category-slot";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Sub-hire groups with no category placement (`targetCategoryId IS NULL`).
 */
export async function getUncategorizedSubHireGroups(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const lineItemInclude = {
    asset: true,
    bulkAsset: true,
    kit: true,
    childLineItems: {
      include: {
        asset: true,
        bulkAsset: true,
        kit: true,
      },
      orderBy: { sortOrder: "asc" as const },
    },
  };
  const groups = await prisma.subHireGroup.findMany({
    where: {
      targetCategoryId: null,
      subHire: { projectId, organizationId },
    },
    include: {
      subHire: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          supplierId: true,
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
  });
  const attachMaps = await buildLineItemAttachMaps(organizationId);
  const attached = groups.map((g) => ({
    ...g,
    subHire: {
      ...g.subHire,
      supplier: resolveAttachedSupplier(g.subHire.supplierId, attachMaps),
    },
    lineItems: attachLineItemTree(g.lineItems, attachMaps),
  }));
  return serialize(attached);
}

/**
 * Project groups with no category placement (`categoryId` absent/null in Convex).
 */
export async function getUncategorizedProjectGroups(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const client = await getConvexClient();

  const allGroups = await client.query(api.projectGroups.listByProject, { projectId, orgId: organizationId });
  const uncategorized = allGroups
    .filter((g) => !g.categoryId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (uncategorized.length === 0) return serialize([]);

  const groupIds = uncategorized.map((g) => g.id);
  const lineItemInclude = {
    asset: true,
    bulkAsset: true,
    kit: true,
    childLineItems: {
      include: { asset: true, bulkAsset: true, kit: true },
      orderBy: { sortOrder: "asc" as const },
    },
  };
  const allLineItems = await prisma.projectLineItem.findMany({
    where: { groupId: { in: groupIds }, isKitChild: false, parentLineItemId: null },
    include: lineItemInclude,
    orderBy: { sortOrder: "asc" },
  });

  const lineItemsByGroupId = new Map<string, typeof allLineItems[number][]>();
  for (const li of allLineItems) {
    if (li.groupId) {
      const arr = lineItemsByGroupId.get(li.groupId) ?? [];
      arr.push(li);
      lineItemsByGroupId.set(li.groupId, arr);
    }
  }

  const attachMaps = await buildLineItemAttachMaps(organizationId);
  const attached = uncategorized.map((g) => ({
    ...g,
    price: g.price ?? null,
    suggestedPrice: g.suggestedPrice ?? null,
    rentalPeriod: g.rentalPeriod ?? null,
    rentalQuantity: g.rentalQuantity ?? null,
    createdAt: new Date(g.createdAt ?? 0),
    updatedAt: new Date(g.updatedAt ?? 0),
    lineItems: attachLineItemTree(lineItemsByGroupId.get(g.id) ?? [], attachMaps),
  }));

  return serialize(attached);
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Move a sub-hire group between categories (or to uncategorised).
 */
export async function moveSubHireGroupToCategory(
  input: MoveSubHireGroupToCategoryInput,
) {
  const parsed = moveSubHireGroupToCategorySchema.parse(input);
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items",
  );
  await requirePermission("subHire", "update");

  const group = await prisma.subHireGroup.findFirst({
    where: { id: parsed.groupId, subHire: { organizationId } },
    include: { subHire: { select: { id: true, projectId: true } } },
  });
  if (!group) {
    throw new Error("Sub-hire group not found");
  }

  let destCategoryId: string | null = null;
  if (parsed.categoryId) {
    const client = await getConvexClient();
    const category = await client.query(api.projectCategories.getById, { id: parsed.categoryId });
    if (!category || category.organizationId !== organizationId) {
      throw new Error("Destination category not found");
    }
    if (group.subHire.projectId && category.projectId !== group.subHire.projectId) {
      throw new Error("Cannot move sub-hire group across projects");
    }
    destCategoryId = category.id;
  }

  // Prisma writes: subHireGroup placement + synthetic parent line item categoryId.
  // No advisory lock needed (CategorySlot is Convex-only now).
  await prisma.$transaction(async (tx) => {
    await tx.subHireGroup.update({
      where: { id: parsed.groupId },
      data: { targetCategoryId: destCategoryId },
    });
    await tx.projectLineItem.updateMany({
      where: {
        subHireGroupId: parsed.groupId,
        isKitChild: false,
        parentLineItemId: null,
      },
      data: { categoryId: destCategoryId },
    });
  });

  // Convex CategorySlot writes (atomic to prevent concurrent duplicates).
  const client = await getConvexClient();
  const now = Date.now();
  await client.mutation(api.categorySlots.upsertSlotForSubHireGroup, {
    subHireGroupId: parsed.groupId,
    destCategoryId,
    newSlotId: createId(),
    now,
  });

  await syncSubHireToConvex(group.subHire.id);
  if (group.subHire.projectId) {
    await upsertProjectLineItemsToConvex(group.subHire.projectId);
    await recalculateProjectTotals(group.subHire.projectId);
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "updated",
      entityType: "project",
      entityId: group.subHire.projectId,
      entityName: `Sub-hire group ${parsed.groupId}`,
      summary: destCategoryId
        ? `Moved sub-hire group to category ${destCategoryId}`
        : `Moved sub-hire group to uncategorised`,
    });
  }

  return serialize({ success: true });
}

/**
 * Move a ProjectGroup to a different ProjectCategory, or to the
 * Uncategorized zone when `categoryId` is null.
 */
export async function moveProjectGroupToCategory(
  input: MoveProjectGroupToCategoryInput,
) {
  const parsed = moveProjectGroupToCategorySchema.parse(input);
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items",
  );

  const client = await getConvexClient();
  const group = await client.query(api.projectGroups.getById, { id: parsed.groupId });
  if (!group || group.organizationId !== organizationId) {
    throw new Error("Project group not found");
  }

  let destCategoryId: string | null = null;
  let destCategoryName: string | null = null;
  if (parsed.categoryId) {
    const category = await client.query(api.projectCategories.getById, { id: parsed.categoryId });
    if (!category || category.organizationId !== organizationId) {
      throw new Error("Destination category not found");
    }
    if (category.projectId !== group.projectId) {
      throw new Error("Cannot move project group across projects");
    }
    destCategoryId = category.id;
    destCategoryName = category.name;
  }

  // No-op fast path.
  if ((group.categoryId ?? null) === destCategoryId) {
    return serialize({ success: true, noop: true });
  }

  // Prisma write: keep line-item categoryId in sync.
  await prisma.projectLineItem.updateMany({
    where: { groupId: parsed.groupId, organizationId },
    data: { categoryId: destCategoryId },
  });

  // Convex writes: group categoryId + slot (atomic to prevent concurrent duplicates).
  const now = Date.now();
  await client.mutation(api.projectGroups.update, {
    id: parsed.groupId,
    // Pass null explicitly so Convex clears the field (undefined is stripped by JSON serialization).
    patch: { categoryId: destCategoryId, updatedAt: now },
  });

  await client.mutation(api.categorySlots.upsertSlotForProjectGroup, {
    projectGroupId: parsed.groupId,
    destCategoryId,
    newSlotId: createId(),
    now,
  });

  await upsertProjectLineItemsToConvex(group.projectId);

  await recalculateProjectTotals(group.projectId);
  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: group.projectId,
    entityName: `Project group ${group.title}`,
    summary: destCategoryName
      ? `Moved project group to category ${destCategoryName}`
      : `Moved project group to uncategorised`,
  });

  return serialize({ success: true });
}

/**
 * Reorder the mixed ProjectGroup + SubHireGroup list within a single
 * ProjectCategory. IDs are prefixed (`pg-` / `shg-`) so one ordered array
 * can address both kinds.
 */
export async function reorderMixedGroupsInCategory(
  input: ReorderMixedGroupsInCategoryInput,
) {
  const parsed = reorderMixedGroupsInCategorySchema.parse(input);
  const { organizationId } = await requirePermission("project", "manage_line_items");
  await requirePermission("subHire", "update");

  const client = await getConvexClient();
  const category = await client.query(api.projectCategories.getById, { id: parsed.categoryId });
  if (!category || category.organizationId !== organizationId) {
    throw new Error("Category not found");
  }

  const sortedByPrefixedId = parsed.orderedIds
    .map((prefixedId, displayIndex) => ({ prefixedId, displayIndex }))
    .sort((a, b) => (a.prefixedId < b.prefixedId ? -1 : a.prefixedId > b.prefixedId ? 1 : 0));

  const parsedSlots = sortedByPrefixedId
    .map(({ prefixedId }) => parseSlotId(prefixedId))
    .filter((s): s is NonNullable<typeof s> => s != null);
  const projectGroupIds = parsedSlots.filter((s) => s.kind === "projectGroup").map((s) => s.id);
  const subHireGroupIds = parsedSlots.filter((s) => s.kind === "subHireGroup").map((s) => s.id);

  // Cross-org validation for project groups via Convex
  if (projectGroupIds.length > 0) {
    const allGroups = await client.query(api.projectGroups.listByProject, {
      projectId: category.projectId,
      orgId: organizationId,
    });
    const groupIdSet = new Set(allGroups.map((g) => g.id));
    for (const id of projectGroupIds) {
      if (!groupIdSet.has(id)) {
        throw new Error("One or more project groups do not belong to this project");
      }
    }
  }

  // Cross-org validation for sub-hire groups via Prisma (subHireGroup stays Prisma)
  if (subHireGroupIds.length > 0) {
    const shgCount = await prisma.subHireGroup.count({
      where: {
        id: { in: subHireGroupIds },
        subHire: { organizationId, projectId: category.projectId },
      },
    });
    if (shgCount !== subHireGroupIds.length) {
      throw new Error("One or more sub-hire groups do not belong to this project");
    }
  }

  const now = Date.now();
  await client.mutation(api.categorySlots.reorderSlots, {
    categoryId: parsed.categoryId,
    items: sortedByPrefixedId.map(({ prefixedId, displayIndex }) => {
      const parsedSlot = parseSlotId(prefixedId)!;
      return {
        kind: parsedSlot.kind,
        groupId: parsedSlot.id,
        sortOrder: displayIndex,
        newSlotId: createId(),
      };
    }).filter(Boolean),
    now,
  });

  return serialize({ success: true });
}

/**
 * Atomic: create a new ProjectCategory and place a single group (project
 * or sub-hire) inside it via a fresh CategorySlot row.
 */
export async function createCategoryAndPlaceGroup(input: CreateCategoryAndPlaceGroupInput) {
  const parsed = createCategoryAndPlaceGroupSchema.parse(input);
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items",
  );

  const project = await getProjectById(parsed.projectId);
  if (!project || project.organizationId !== organizationId) {
    throw new Error("Project not found");
  }

  const projectGroupId = parsed.slot.projectGroupId ?? null;
  const subHireGroupId = parsed.slot.subHireGroupId ?? null;

  const client = await getConvexClient();

  // Cross-org validation on the target group.
  if (projectGroupId) {
    const allGroups = await client.query(api.projectGroups.listByProject, {
      projectId: parsed.projectId,
      orgId: organizationId,
    });
    if (!allGroups.find((g) => g.id === projectGroupId)) {
      throw new Error("Project group not found in this project");
    }
  }
  if (subHireGroupId) {
    const shg = await prisma.subHireGroup.findFirst({
      where: { id: subHireGroupId, subHire: { organizationId, projectId: parsed.projectId } },
      select: { id: true },
    });
    if (!shg) throw new Error("Sub-hire group not found in this project");
  }

  const categoryId = createId();
  const now = Date.now();

  // Delete any existing slot for this group so we don't leak the slot on a
  // re-categorise after the group was already placed somewhere.
  if (projectGroupId) {
    const slots = await client.query(api.categorySlots.listByProjectGroupId, { projectGroupId });
    for (const slot of slots) {
      await client.mutation(api.categorySlots.remove, { id: slot.id });
    }
  } else if (subHireGroupId) {
    const slots = await client.query(api.categorySlots.listBySubHireGroupId, { subHireGroupId });
    for (const slot of slots) {
      await client.mutation(api.categorySlots.remove, { id: slot.id });
    }
  }

  // Create category (atomic create-at-end) and slot in Convex.
  const { sortOrder: categorySortOrder } = await client.mutation(api.projectCategories.createAtEnd, {
    id: categoryId,
    organizationId,
    projectId: parsed.projectId,
    name: parsed.name,
    now,
  });

  await client.mutation(api.categorySlots.create, {
    id: createId(),
    projectCategoryId: categoryId,
    sortOrder: 0,
    projectGroupId: projectGroupId ?? undefined,
    subHireGroupId: subHireGroupId ?? undefined,
    createdAt: now,
    updatedAt: now,
  });

  // Update group placement — ProjectGroup in Convex, SubHireGroup in Prisma.
  if (projectGroupId) {
    await client.mutation(api.projectGroups.update, {
      id: projectGroupId,
      patch: { categoryId, updatedAt: now },
    });
    // Keep line-item categoryId in sync.
    await prisma.projectLineItem.updateMany({
      where: { groupId: projectGroupId, organizationId },
      data: { categoryId },
    });
  } else if (subHireGroupId) {
    await prisma.subHireGroup.update({
      where: { id: subHireGroupId },
      data: { targetCategoryId: categoryId },
    });
    await prisma.projectLineItem.updateMany({
      where: {
        subHireGroupId,
        isKitChild: false,
        parentLineItemId: null,
      },
      data: { categoryId },
    });
  }

  await upsertProjectLineItemsToConvex(parsed.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "created",
    entityType: "project",
    entityId: parsed.projectId,
    entityName: parsed.name,
    summary: `Created category "${parsed.name}" and placed a group inside`,
  });

  await recalculateProjectTotals(parsed.projectId);

  return serialize({
    id: categoryId,
    organizationId,
    projectId: parsed.projectId,
    name: parsed.name,
    sortOrder: categorySortOrder,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
}
