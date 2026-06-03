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

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { recalculateProjectTotals } from "@/server/line-items";
import {
  moveSubHireGroupToCategorySchema,
  reorderMixedGroupsInCategorySchema,
  createCategoryAndPlaceGroupSchema,
  parseSlotId,
  type MoveSubHireGroupToCategoryInput,
  type ReorderMixedGroupsInCategoryInput,
  type CreateCategoryAndPlaceGroupInput,
} from "@/lib/validations/category-slot";

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Sub-hire groups with no category placement (`targetCategoryId IS NULL`).
 * Mirrors `getUncategorizedLineItems` in project-categories.ts so the
 * equipment tab can render both in the same "uncategorised" zone.
 */
export async function getUncategorizedSubHireGroups(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const groups = await prisma.subHireGroup.findMany({
    where: {
      targetCategoryId: null,
      subHire: { projectId, organizationId },
    },
    include: {
      subHire: { select: { id: true, orderNumber: true, status: true, supplier: { select: { id: true, name: true } } } },
      items: true,
      lineItems: {
        where: { isKitChild: false, parentLineItemId: null },
        select: { id: true },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
  return serialize(groups);
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Move a sub-hire group between categories (or to uncategorised). Updates:
 *   - `SubHireGroup.targetCategoryId`
 *   - `categoryId` on the synthetic parent ProjectLineItem
 *   - `CategorySlot` row (created / moved / deleted as needed)
 *
 * Skips the full `syncSubHireToProject` regenerate cascade — placement is
 * metadata, not content (Finding 6.1). Calls `recalculateProjectTotals`
 * once after the write.
 *
 * Permission gate: both `project:manage_line_items` and `subHire:update`
 * — moving a sub-hire group between categories crosses both ownership
 * boundaries, so callers must hold both perms (Finding 5.1).
 */
export async function moveSubHireGroupToCategory(
  input: MoveSubHireGroupToCategoryInput,
) {
  const parsed = moveSubHireGroupToCategorySchema.parse(input);
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items",
  );
  // Second perm check — cross-type writes need sub-hire update too.
  await requirePermission("subHire", "update");

  // Cross-org validation: the sub-hire group must belong to this org, and
  // the destination category (if any) must also belong to this org.
  const group = await prisma.subHireGroup.findFirst({
    where: { id: parsed.groupId, subHire: { organizationId } },
    include: { subHire: { select: { id: true, projectId: true } } },
  });
  if (!group) {
    throw new Error("Sub-hire group not found");
  }

  let destCategoryId: string | null = null;
  if (parsed.categoryId) {
    const category = await prisma.projectCategory.findFirst({
      where: { id: parsed.categoryId, organizationId },
      select: { id: true, projectId: true, name: true },
    });
    if (!category) {
      throw new Error("Destination category not found");
    }
    if (group.subHire.projectId && category.projectId !== group.subHire.projectId) {
      throw new Error("Cannot move sub-hire group across projects");
    }
    destCategoryId = category.id;
  }

  // Run all writes in one transaction so the SubHireGroup, its synthetic
  // parent line item, and the CategorySlot stay consistent on failure.
  await prisma.$transaction(async (tx) => {
    // 1. Update the group's placement field.
    await tx.subHireGroup.update({
      where: { id: parsed.groupId },
      data: { targetCategoryId: destCategoryId },
    });

    // 2. Update the synthetic parent ProjectLineItem so the existing tab
    //    query — which still keys on ProjectLineItem.categoryId — sees the
    //    move immediately. Skipped if no parent exists yet (the sub-hire
    //    may not have synced line items).
    await tx.projectLineItem.updateMany({
      where: {
        subHireGroupId: parsed.groupId,
        isKitChild: false,
        parentLineItemId: null,
      },
      data: { categoryId: destCategoryId },
    });

    // 3. Delete any existing slot row for this group; if a new category
    //    was picked, insert a fresh one at the end of that category.
    await tx.categorySlot.deleteMany({ where: { subHireGroupId: parsed.groupId } });
    if (destCategoryId) {
      const lastSlot = await tx.categorySlot.findFirst({
        where: { projectCategoryId: destCategoryId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      await tx.categorySlot.create({
        data: {
          projectCategoryId: destCategoryId,
          subHireGroupId: parsed.groupId,
          sortOrder: (lastSlot?.sortOrder ?? -1) + 1,
        },
      });
    }
  });

  if (group.subHire.projectId) {
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
 * Reorder the mixed ProjectGroup + SubHireGroup list within a single
 * ProjectCategory. IDs are prefixed (`pg-` / `shg-`) so one ordered array
 * can address both kinds.
 *
 * Concurrency: we UPDATE rows sorted by id ASC so two concurrent reorders
 * touching overlapping IDs always acquire row locks in the same order,
 * which prevents deadlocks (Finding 7.2).
 *
 * Permission gate: both `project:manage_line_items` and `subHire:update`,
 * because a reorder can include sub-hire group rows.
 */
export async function reorderMixedGroupsInCategory(
  input: ReorderMixedGroupsInCategoryInput,
) {
  const parsed = reorderMixedGroupsInCategorySchema.parse(input);
  const { organizationId } = await requirePermission("project", "manage_line_items");
  await requirePermission("subHire", "update");

  const category = await prisma.projectCategory.findFirst({
    where: { id: parsed.categoryId, organizationId },
    select: { id: true },
  });
  if (!category) {
    throw new Error("Category not found");
  }

  // Sort prefixed IDs ascending before issuing UPDATEs to avoid deadlock
  // between two concurrent reorders of overlapping lists.
  const sortedByPrefixedId = parsed.orderedIds
    .map((prefixedId, displayIndex) => ({ prefixedId, displayIndex }))
    .sort((a, b) => (a.prefixedId < b.prefixedId ? -1 : a.prefixedId > b.prefixedId ? 1 : 0));

  await prisma.$transaction(async (tx) => {
    for (const { prefixedId, displayIndex } of sortedByPrefixedId) {
      const parsedSlot = parseSlotId(prefixedId);
      if (!parsedSlot) continue; // Zod already rejected, defensive guard.
      const where = parsedSlot.kind === "projectGroup"
        ? { projectGroupId: parsedSlot.id }
        : { subHireGroupId: parsedSlot.id };

      // Upsert via deleteMany+create — projectGroupId/subHireGroupId are
      // unique columns, but the slot may not exist yet (legacy groups
      // pre-CategorySlot migration). Two-step keeps it portable.
      const existing = await tx.categorySlot.findFirst({ where });
      if (existing) {
        await tx.categorySlot.update({
          where: { id: existing.id },
          data: { sortOrder: displayIndex, projectCategoryId: parsed.categoryId },
        });
      } else {
        await tx.categorySlot.create({
          data: {
            projectCategoryId: parsed.categoryId,
            sortOrder: displayIndex,
            ...where,
          },
        });
      }
    }
  });

  return serialize({ success: true });
}

/**
 * Atomic: create a new ProjectCategory and place a single group (project
 * or sub-hire) inside it via a fresh CategorySlot row. Used by the
 * "Create '<text>'" footer option in the move dialog's category combobox
 * (Section 8E.b) — avoids orphan-on-failure if the slot insert fails
 * after the category insert succeeded.
 */
export async function createCategoryAndPlaceGroup(input: CreateCategoryAndPlaceGroupInput) {
  const parsed = createCategoryAndPlaceGroupSchema.parse(input);
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items",
  );

  // Project must belong to this org.
  const project = await prisma.project.findFirst({
    where: { id: parsed.projectId, organizationId },
    select: { id: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }

  const projectGroupId = parsed.slot.projectGroupId ?? null;
  const subHireGroupId = parsed.slot.subHireGroupId ?? null;

  // Cross-org validation on the target group too — placement crosses the
  // group ↔ category FK, so both sides have to belong to this org.
  if (projectGroupId) {
    const pg = await prisma.projectGroup.findFirst({
      where: { id: projectGroupId, organizationId, projectId: parsed.projectId },
      select: { id: true },
    });
    if (!pg) throw new Error("Project group not found in this project");
  }
  if (subHireGroupId) {
    const shg = await prisma.subHireGroup.findFirst({
      where: { id: subHireGroupId, subHire: { organizationId, projectId: parsed.projectId } },
      select: { id: true },
    });
    if (!shg) throw new Error("Sub-hire group not found in this project");
  }

  // New category goes to end of project's category list per Section 8E.c.
  const result = await prisma.$transaction(async (tx) => {
    const maxSort = await tx.projectCategory.aggregate({
      where: { projectId: parsed.projectId, organizationId },
      _max: { sortOrder: true },
    });
    const category = await tx.projectCategory.create({
      data: {
        organizationId,
        projectId: parsed.projectId,
        name: parsed.name,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    // Reset any existing slot for this group so we don't leak the
    // UNIQUE(projectGroupId)/UNIQUE(subHireGroupId) constraint.
    if (projectGroupId) {
      await tx.categorySlot.deleteMany({ where: { projectGroupId } });
    } else if (subHireGroupId) {
      await tx.categorySlot.deleteMany({ where: { subHireGroupId } });
    }

    await tx.categorySlot.create({
      data: {
        projectCategoryId: category.id,
        sortOrder: 0,
        projectGroupId,
        subHireGroupId,
      },
    });

    // Keep the group's own placement fields in sync so consumers that
    // read SubHireGroup.targetCategoryId / ProjectGroup.categoryId
    // directly (e.g. PDFs) see the new home.
    if (projectGroupId) {
      await tx.projectGroup.update({
        where: { id: projectGroupId },
        data: { categoryId: category.id },
      });
    } else if (subHireGroupId) {
      await tx.subHireGroup.update({
        where: { id: subHireGroupId },
        data: { targetCategoryId: category.id },
      });
      await tx.projectLineItem.updateMany({
        where: {
          subHireGroupId,
          isKitChild: false,
          parentLineItemId: null,
        },
        data: { categoryId: category.id },
      });
    }

    return category;
  });

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

  return serialize(result);
}
