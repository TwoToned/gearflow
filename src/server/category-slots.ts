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
import {
  buildLineItemAttachMaps,
  attachLineItemTree,
  resolveAttachedSupplier,
  type LineItemAttachMaps,
} from "@/lib/line-item-tree-read";
import { mapLineItemDoc, type MappedLineItem } from "@/lib/project-line-item-read";
import { indexChildren, reconstructScope } from "@/lib/project-line-item-tree-read";
import { getAssetsByOrg, getBulkAssetsByOrg, type ConvexAsset, type ConvexBulkAsset } from "@/lib/assets-read";
import { getKitsByOrg, type ConvexKit } from "@/lib/kits-read";
import { getSubHiresByProject, getSubHireGroups, getSubHireItems } from "@/lib/sub-hire-read";
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

// ── Line-item tree attach (Convex) ────────────────────────────────────────────

const ASSET_DATE_KEYS = [
  "purchaseDate",
  "warrantyExpiry",
  "lastTestAndTagDate",
  "nextTestAndTagDate",
  "createdAt",
  "updatedAt",
] as const;
const BULK_ASSET_DATE_KEYS = ["lastReorderedAt", "createdAt", "updatedAt"] as const;
const KIT_DATE_KEYS = ["purchaseDate", "createdAt", "updatedAt"] as const;

function stripMetaDates<T extends Record<string, unknown>>(doc: T, dateKeys: readonly string[]): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = doc as Record<string, unknown>;
  void _id;
  void _creationTime;
  for (const k of dateKeys) {
    if (rest[k] != null) rest[k] = new Date(rest[k] as number);
  }
  return rest;
}

/** Attach full `asset` / `bulkAsset` / `kit` Convex docs (meta stripped, dates →
 *  Date) onto every node of a model/supplier-attached tree (plain kit, no
 *  `_count`). A miss → null. */
function attachAssetBulkKitPlain<T extends { assetId?: string | null; bulkAssetId?: string | null; kitId?: string | null; childLineItems?: unknown }>(
  rows: T[],
  assetMap: Map<string, ConvexAsset>,
  bulkAssetMap: Map<string, ConvexBulkAsset>,
  kitMap: Map<string, ConvexKit>,
): T[] {
  return rows.map((row) => {
    const children = row.childLineItems;
    const assetDoc = row.assetId ? assetMap.get(row.assetId) : undefined;
    const bulkDoc = row.bulkAssetId ? bulkAssetMap.get(row.bulkAssetId) : undefined;
    const kitDoc = row.kitId ? kitMap.get(row.kitId) : undefined;
    return {
      ...row,
      asset: assetDoc ? stripMetaDates(assetDoc, ASSET_DATE_KEYS) : null,
      bulkAsset: bulkDoc ? stripMetaDates(bulkDoc, BULK_ASSET_DATE_KEYS) : null,
      kit: kitDoc ? stripMetaDates(kitDoc, KIT_DATE_KEYS) : null,
      ...(Array.isArray(children)
        ? { childLineItems: attachAssetBulkKitPlain(children as T[], assetMap, bulkAssetMap, kitMap) }
        : {}),
    };
  }) as T[];
}

interface AttachContext {
  attachMaps: LineItemAttachMaps;
  assetMap: Map<string, ConvexAsset>;
  bulkAssetMap: Map<string, ConvexBulkAsset>;
  kitMap: Map<string, ConvexKit>;
}

async function loadAttachContext(orgId: string): Promise<AttachContext> {
  const [attachMaps, assetArr, bulkArr, kitArr] = await Promise.all([
    buildLineItemAttachMaps(orgId),
    getAssetsByOrg(orgId),
    getBulkAssetsByOrg(orgId),
    getKitsByOrg(orgId),
  ]);
  return {
    attachMaps,
    assetMap: new Map(assetArr.map((a) => [a.id, a])),
    bulkAssetMap: new Map(bulkArr.map((b) => [b.id, b])),
    kitMap: new Map(kitArr.map((k) => [k.id, k])),
  };
}

/** Reconstruct (childLineItems depth 1, no units) + fully attach a scope of
 *  mapped line items — matching the old Prisma include shape used by these reads. */
function attachScopeRows(
  scopeRows: MappedLineItem[],
  byParent: Map<string, MappedLineItem[]>,
  ctx: AttachContext,
) {
  const reconstructed = reconstructScope(scopeRows, byParent, {
    unitsByLineItem: new Map(),
    depth: 1,
  });
  const withModelSupplier = attachLineItemTree(reconstructed, ctx.attachMaps);
  return attachAssetBulkKitPlain(withModelSupplier as never[], ctx.assetMap, ctx.bulkAssetMap, ctx.kitMap);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Sub-hire groups with no category placement (`targetCategoryId IS NULL`).
 */
export async function getUncategorizedSubHireGroups(projectId: string) {
  const { organizationId } = await requirePermission("project", "read");
  const client = await getConvexClient();

  // Sub-hires (+ their groups/items) live in Convex (dual-written); line items
  // are Convex-only. Read everything from Convex — the Prisma relation includes
  // returned stale `project_line_item` rows (frozen table) after the mega-flip.
  const subHires = await getSubHiresByProject(projectId, organizationId);
  if (subHires.length === 0) return serialize([]);

  // Uncategorized groups across all the project's sub-hires, sorted by sortOrder.
  const groupArrays = await Promise.all(subHires.map((sh) => getSubHireGroups(sh.id)));
  const groups = groupArrays
    .flat()
    .filter((g) => g.targetCategoryId == null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (groups.length === 0) return serialize([]);

  const subHireById = new Map(subHires.map((sh) => [sh.id, sh]));
  const groupIdSet = new Set(groups.map((g) => g.id));

  // Items for each group (filtered to that group from its sub-hire's item list).
  const itemsBySubHire = new Map(
    await Promise.all(
      subHires.map(async (sh) => [sh.id, await getSubHireItems(sh.id)] as const),
    ),
  );

  // Line items from Convex: top-level lines whose `subHireGroupId` is in our set.
  const liDocs = await client.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const mappedLineItems = liDocs.map(mapLineItemDoc);
  const byParent = indexChildren(mappedLineItems);
  const lineItemsByGroupId = new Map<string, MappedLineItem[]>();
  for (const li of mappedLineItems) {
    if (li.isKitChild || li.parentLineItemId) continue;
    if (li.subHireGroupId && groupIdSet.has(li.subHireGroupId)) {
      const arr = lineItemsByGroupId.get(li.subHireGroupId) ?? [];
      arr.push(li);
      lineItemsByGroupId.set(li.subHireGroupId, arr);
    }
  }

  const attachMaps = await buildLineItemAttachMaps(organizationId);
  const ctx = await loadAttachContext(organizationId);
  const attached = groups.map((g) => {
    const subHire = subHireById.get(g.subHireId)!;
    const items = (itemsBySubHire.get(g.subHireId) ?? []).filter((i) => i.groupId === g.id);
    return {
      ...g,
      items,
      subHire: {
        id: subHire.id,
        orderNumber: subHire.orderNumber,
        status: subHire.status,
        supplierId: subHire.supplierId,
        supplier: resolveAttachedSupplier(subHire.supplierId, attachMaps),
      },
      lineItems: attachScopeRows(lineItemsByGroupId.get(g.id) ?? [], byParent, ctx),
    };
  });
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

  const groupIdSet = new Set(uncategorized.map((g) => g.id));

  const liDocs = await client.query(api.projectLineItems.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const mappedLineItems = liDocs.map(mapLineItemDoc);

  // Top-level items whose group is one of the uncategorized groups.
  const byParent = indexChildren(mappedLineItems);
  const lineItemsByGroupId = new Map<string, MappedLineItem[]>();
  for (const li of mappedLineItems) {
    if (li.isKitChild || li.parentLineItemId) continue;
    if (li.groupId && groupIdSet.has(li.groupId)) {
      const arr = lineItemsByGroupId.get(li.groupId) ?? [];
      arr.push(li);
      lineItemsByGroupId.set(li.groupId, arr);
    }
  }

  const ctx = await loadAttachContext(organizationId);
  const attached = uncategorized.map((g) => ({
    ...g,
    price: g.price ?? null,
    suggestedPrice: g.suggestedPrice ?? null,
    rentalPeriod: g.rentalPeriod ?? null,
    rentalQuantity: g.rentalQuantity ?? null,
    createdAt: new Date(g.createdAt ?? 0),
    updatedAt: new Date(g.updatedAt ?? 0),
    lineItems: attachScopeRows(lineItemsByGroupId.get(g.id) ?? [], byParent, ctx),
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

  // Convex write: subHireGroup placement (Convex-only now).
  const client = await getConvexClient();
  await client.mutation(api.subHireGroups.patchGroup, {
    id: parsed.groupId,
    set: destCategoryId != null ? { targetCategoryId: destCategoryId } : {},
    clear: destCategoryId != null ? [] : ["targetCategoryId"],
  });

  // Convex write: synthetic parent line item categoryId on the sub-hire group's
  // top-level lines (line items are Convex-only now).
  if (group.subHire.projectId) {
    const liDocs = await client.query(api.projectLineItems.listByProject, {
      projectId: group.subHire.projectId,
      orgId: organizationId,
    });
    const targets = liDocs.filter(
      (li) => li.subHireGroupId === parsed.groupId && !li.isKitChild && li.parentLineItemId == null,
    );
    const nowSet = Date.now();
    for (const li of targets) {
      await client.mutation(api.projectLineItems.patchLineItem, {
        id: li.id,
        set: destCategoryId != null ? { categoryId: destCategoryId, updatedAt: nowSet } : { updatedAt: nowSet },
        clear: destCategoryId != null ? [] : ["categoryId"],
      });
    }
  }

  // Convex CategorySlot writes (atomic to prevent concurrent duplicates).
  const now = Date.now();
  await client.mutation(api.categorySlots.upsertSlotForSubHireGroup, {
    subHireGroupId: parsed.groupId,
    destCategoryId,
    newSlotId: createId(),
    now,
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

  // Convex write: keep line-item categoryId in sync (line items are Convex-only now).
  const groupLiDocs = await client.query(api.projectLineItems.listByProject, {
    projectId: group.projectId,
    orgId: organizationId,
  });
  const groupLineItems = groupLiDocs.filter((li) => li.groupId === parsed.groupId);
  const nowSet = Date.now();
  for (const li of groupLineItems) {
    await client.mutation(api.projectLineItems.patchLineItem, {
      id: li.id,
      set: destCategoryId != null ? { categoryId: destCategoryId, updatedAt: nowSet } : { updatedAt: nowSet },
      clear: destCategoryId != null ? [] : ["categoryId"],
    });
  }

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
  // Line items are Convex-only now; keep their categoryId in sync via Convex.
  const placementLiDocs = await client.query(api.projectLineItems.listByProject, {
    projectId: parsed.projectId,
    orgId: organizationId,
  });
  if (projectGroupId) {
    await client.mutation(api.projectGroups.update, {
      id: projectGroupId,
      patch: { categoryId, updatedAt: now },
    });
    const targets = placementLiDocs.filter((li) => li.groupId === projectGroupId);
    for (const li of targets) {
      await client.mutation(api.projectLineItems.patchLineItem, {
        id: li.id,
        set: { categoryId, updatedAt: now },
        clear: [],
      });
    }
  } else if (subHireGroupId) {
    await client.mutation(api.subHireGroups.patchGroup, {
      id: subHireGroupId,
      set: { targetCategoryId: categoryId },
    });
    const targets = placementLiDocs.filter(
      (li) => li.subHireGroupId === subHireGroupId && !li.isKitChild && li.parentLineItemId == null,
    );
    for (const li of targets) {
      await client.mutation(api.projectLineItems.patchLineItem, {
        id: li.id,
        set: { categoryId, updatedAt: now },
        clear: [],
      });
    }
  }

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
