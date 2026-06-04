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
  moveProjectGroupToCategorySchema,
  reorderMixedGroupsInCategorySchema,
  createCategoryAndPlaceGroupSchema,
  parseSlotId,
  type MoveSubHireGroupToCategoryInput,
  type MoveProjectGroupToCategoryInput,
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
  // Mirrors the lineItem include used by getProjectCategories so the
  // equipment tab can render orphan sub-hire groups with full child
  // expansion without an additional query.
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
    // Serialize concurrent moves into the SAME destination category.
    // Without this, two parallel moves both read max(sortOrder) and try
    // to INSERT at sortOrder = N + 1, racing on
    // UNIQUE(projectCategoryId, sortOrder). Mirrors the lock used by
    // reorderMixedGroupsInCategory (Finding 7.2 / S11). Null destination
    // (move to uncategorised) bypasses the lock since there's no slot
    // to insert.
    if (destCategoryId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${destCategoryId})::bigint)`;
    }

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
 * Move a ProjectGroup to a different ProjectCategory.
 *
 * Updates three things in one transaction:
 *   - `ProjectGroup.categoryId` — the canonical placement.
 *   - `ProjectLineItem.categoryId` for every item in the group — keeps
 *     line-item category in sync so any filter that scopes by category
 *     (PDFs, reports) sees the move.
 *   - `CategorySlot` row — appended to the end of the destination
 *     category so the unified mixed-group order stays consistent with
 *     sub-hire groups already living there.
 *
 * Unlike `moveSubHireGroupToCategory`, the destination is required —
 * `ProjectGroup.categoryId` is NOT NULL in the schema.
 *
 * Concurrency: the same `pg_advisory_xact_lock` keyed on destination
 * categoryId that protects sub-hire moves (Finding 7.2 / S11). Two
 * parallel moves of the same group would otherwise race on
 * `UNIQUE(projectCategoryId, sortOrder)` when inserting their CategorySlot.
 *
 * Permission gate: only `project:manage_line_items` (no sub-hire perm
 * needed — this action never touches sub-hire data).
 */
export async function moveProjectGroupToCategory(
  input: MoveProjectGroupToCategoryInput,
) {
  const parsed = moveProjectGroupToCategorySchema.parse(input);
  const { organizationId, userId, userName } = await requirePermission(
    "project",
    "manage_line_items",
  );

  // Cross-org / cross-project validation: the group AND the destination
  // category must both belong to this org and to the same project.
  const group = await prisma.projectGroup.findFirst({
    where: { id: parsed.groupId, organizationId },
    select: { id: true, projectId: true, categoryId: true, title: true },
  });
  if (!group) {
    throw new Error("Project group not found");
  }

  const category = await prisma.projectCategory.findFirst({
    where: { id: parsed.categoryId, organizationId },
    select: { id: true, projectId: true, name: true },
  });
  if (!category) {
    throw new Error("Destination category not found");
  }
  if (category.projectId !== group.projectId) {
    throw new Error("Cannot move project group across projects");
  }

  // No-op fast path — saves a transaction round-trip when the user
  // picks the same category the group is already in (e.g. accidental
  // double-confirm in the move dialog).
  if (group.categoryId === parsed.categoryId) {
    return serialize({ success: true, noop: true });
  }

  await prisma.$transaction(async (tx) => {
    // Serialize concurrent moves into the same destination category.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${parsed.categoryId})::bigint)`;

    // 1. Move the group itself.
    await tx.projectGroup.update({
      where: { id: parsed.groupId },
      data: { categoryId: parsed.categoryId },
    });

    // 2. Keep line-item categoryId in sync. Items follow their group —
    //    any consumer that filters by categoryId (PDFs, reports, the
    //    Uncategorized zone query) sees the move immediately.
    await tx.projectLineItem.updateMany({
      where: {
        groupId: parsed.groupId,
        organizationId,
      },
      data: { categoryId: parsed.categoryId },
    });

    // 3. Update the CategorySlot — delete any existing slot for this
    //    project group and insert a fresh one at the end of the
    //    destination category's slot list. Mirrors the sub-hire flow.
    await tx.categorySlot.deleteMany({ where: { projectGroupId: parsed.groupId } });
    const lastSlot = await tx.categorySlot.findFirst({
      where: { projectCategoryId: parsed.categoryId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await tx.categorySlot.create({
      data: {
        projectCategoryId: parsed.categoryId,
        projectGroupId: parsed.groupId,
        sortOrder: (lastSlot?.sortOrder ?? -1) + 1,
      },
    });
  });

  await recalculateProjectTotals(group.projectId);
  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "project",
    entityId: group.projectId,
    entityName: `Project group ${group.title}`,
    summary: `Moved project group to category ${category.name}`,
  });

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
    select: { id: true, projectId: true },
  });
  if (!category) {
    throw new Error("Category not found");
  }

  // Cross-org slot-ID validation. Every parsed pg-/shg- ID must reference
  // a group that belongs to this org AND this project. Without this check
  // a malicious caller could craft a payload like
  // `orderedIds=[pg-<otherOrgGroupId>]` and reparent another org's slot
  // under our category via the upsert path below.
  const sortedByPrefixedId = parsed.orderedIds
    .map((prefixedId, displayIndex) => ({ prefixedId, displayIndex }))
    .sort((a, b) => (a.prefixedId < b.prefixedId ? -1 : a.prefixedId > b.prefixedId ? 1 : 0));

  const parsedSlots = sortedByPrefixedId
    .map(({ prefixedId }) => parseSlotId(prefixedId))
    .filter((s): s is NonNullable<typeof s> => s != null);
  const projectGroupIds = parsedSlots
    .filter((s) => s.kind === "projectGroup")
    .map((s) => s.id);
  const subHireGroupIds = parsedSlots
    .filter((s) => s.kind === "subHireGroup")
    .map((s) => s.id);

  if (projectGroupIds.length > 0) {
    const pgCount = await prisma.projectGroup.count({
      where: {
        id: { in: projectGroupIds },
        organizationId,
        projectId: category.projectId,
      },
    });
    if (pgCount !== projectGroupIds.length) {
      throw new Error("One or more project groups do not belong to this project");
    }
  }
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

  await prisma.$transaction(async (tx) => {
    // Serialize concurrent reorders of the SAME category. UNIQUE
    // (projectCategoryId, sortOrder) would otherwise blow up two
    // parallel calls — they each compute their target sortOrders
    // independently and would collide mid-flight. pg_advisory_xact_lock
    // is per-Postgres-connection and auto-releases at COMMIT/ROLLBACK,
    // so it scopes serialization to one category and doesn't block
    // unrelated reorders. See Finding 7.2 in the cross-type
    // unification plan.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${parsed.categoryId})::bigint)`;

    // Phase 1: free up the positive sortOrder range so the upserts
    // below can write their target sortOrders without temporary
    // collisions during the loop. UPDATE-all sets every existing slot
    // in this category to a negative number that mirrors its current
    // sortOrder — guaranteed distinct because the original sortOrders
    // were distinct under the same UNIQUE constraint.
    await tx.$executeRaw`
      UPDATE category_slot
      SET "sortOrder" = -1 - "sortOrder"
      WHERE "projectCategoryId" = ${parsed.categoryId}
    `;

    for (const { prefixedId, displayIndex } of sortedByPrefixedId) {
      const parsedSlot = parseSlotId(prefixedId);
      if (!parsedSlot) continue; // Zod already rejected, defensive guard.
      const where = parsedSlot.kind === "projectGroup"
        ? { projectGroupId: parsedSlot.id }
        : { subHireGroupId: parsedSlot.id };

      // Upsert via find+update/create — projectGroupId/subHireGroupId
      // are unique columns, but the slot may not exist yet (legacy
      // groups pre-CategorySlot migration). Two-step keeps it portable.
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
      // Mirror the sub-hire branch: keep the line items' categoryId in
      // sync so any consumer that filters by category (PDFs, reports,
      // the Uncategorized zone query) sees the new home.
      await tx.projectLineItem.updateMany({
        where: { groupId: projectGroupId, organizationId },
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
