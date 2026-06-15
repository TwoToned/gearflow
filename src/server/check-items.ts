"use server";

import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  mirrorModelCheckItemCreate,
  removeModelCheckItemFromConvex,
  syncModelCheckItemsForModels,
  mirrorKitCheckItemCreate,
  removeKitCheckItemFromConvex,
  syncKitCheckItemsForKit,
} from "@/lib/check-item-assignment-mirror";
import {
  checkItemSchema,
  type CheckItemFormValues,
  reorderModelCheckItemsSchema,
  type ReorderModelCheckItemsValues,
} from "@/lib/validations/check-item";

// Check items are DUAL-WRITTEN: every create/update/delete writes the Prisma
// `check_item` row (the durable FK anchor — model_check_item, kit_check_item, and
// check_record all carry a required + Cascade FK to it) AND the Convex
// `checkItems` doc (the reactive read source). Prisma is written first; the Convex
// payload is derived from the written row via toConvexDoc so they can't drift. The
// model/kit assignment join tables + cross-domain readers stay on the always-fresh
// Prisma mirror. See FEATUREDOCS/54.

/** Mirror a freshly written Prisma check-item row into Convex (create). */
async function mirrorCheckItemToConvex(row: Record<string, unknown>) {
  await (await getConvexClient()).mutation(
    api.checkItems.createIfMissing,
    toConvexDoc(row) as FunctionArgs<typeof api.checkItems.createIfMissing>,
  );
}

/** Mirror an updated Prisma check-item row into Convex (patch, id stripped). */
async function patchCheckItemInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...patch } = toConvexDoc(row);
  await (await getConvexClient()).mutation(api.checkItems.update, {
    id,
    patch: patch as FunctionArgs<typeof api.checkItems.update>["patch"],
  });
}

// ─── Check Item Library ─────────────────────────────────────────────────────

export async function getCheckItems() {
  const { organizationId } = await requirePermission("checkItem", "read");

  return serialize(
    await prisma.checkItem.findMany({
      where: { organizationId },
      include: {
        _count: { select: { modelCheckItems: true, checkRecords: true } },
      },
      orderBy: [{ category: "asc" }, { label: "asc" }],
    })
  );
}

/**
 * Per-check-item usage counts (checkItemId -> { modelCheckItems, checkRecords }).
 * Cross-domain: the assignment + record join tables stay in Prisma, so this can't
 * come from Convex. Used by the reactive check-item library, which subscribes to
 * the list via Convex and merges these (non-reactive) counts in.
 */
export async function getCheckItemCounts(): Promise<Record<string, { modelCheckItems: number; checkRecords: number }>> {
  const { organizationId } = await getOrgContext();
  const [modelGroups, recordGroups] = await Promise.all([
    prisma.modelCheckItem.groupBy({ by: ["checkItemId"], where: { organizationId }, _count: { _all: true } }),
    prisma.checkRecord.groupBy({ by: ["checkItemId"], where: { organizationId }, _count: { _all: true } }),
  ]);
  const counts: Record<string, { modelCheckItems: number; checkRecords: number }> = {};
  const ensure = (id: string) => (counts[id] ??= { modelCheckItems: 0, checkRecords: 0 });
  for (const g of modelGroups) if (g.checkItemId) ensure(g.checkItemId).modelCheckItems = g._count._all;
  for (const g of recordGroups) if (g.checkItemId) ensure(g.checkItemId).checkRecords = g._count._all;
  return serialize(counts);
}

export async function getCheckItem(id: string) {
  const { organizationId } = await requirePermission("checkItem", "read");

  const item = await prisma.checkItem.findFirst({
    where: { id, organizationId },
    include: {
      _count: { select: { modelCheckItems: true, checkRecords: true } },
      modelCheckItems: {
        include: { model: { select: { id: true, name: true } } },
        orderBy: { model: { name: "asc" } },
      },
    },
  });

  if (!item) {
    throw new Error("Check item not found");
  }

  return serialize(item);
}

export async function createCheckItem(data: CheckItemFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "create"
  );
  const parsed = checkItemSchema.parse(data);

  const result = await prisma.checkItem.create({
    data: {
      ...parsed,
      dropdownOptions: parsed.dropdownOptions as unknown as undefined,
      organizationId,
      createdById: userId,
    },
  });
  await mirrorCheckItemToConvex(result);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "checkItem",
    entityId: result.id,
    entityName: result.label,
    summary: `Created check item "${result.label}"`,
  });

  return serialize(result);
}

export async function updateCheckItem(id: string, data: CheckItemFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "update"
  );
  const parsed = checkItemSchema.parse(data);

  const result = await prisma.checkItem.update({
    where: { id, organizationId },
    data: {
      ...parsed,
      dropdownOptions: parsed.dropdownOptions as unknown as undefined,
    },
  });
  await patchCheckItemInConvex(id, result);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "checkItem",
    entityId: result.id,
    entityName: result.label,
    summary: `Updated check item "${result.label}"`,
  });

  return serialize(result);
}

export async function deleteCheckItem(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "delete"
  );

  // Block delete if in use by any model or kit
  const [modelUsage, kitUsage] = await Promise.all([
    prisma.modelCheckItem.count({
      where: { checkItemId: id, organizationId },
    }),
    prisma.kitCheckItem.count({
      where: { checkItemId: id, organizationId },
    }),
  ]);

  if (modelUsage > 0 || kitUsage > 0) {
    const parts: string[] = [];
    if (modelUsage > 0) parts.push(`${modelUsage} model${modelUsage === 1 ? "" : "s"}`);
    if (kitUsage > 0) parts.push(`${kitUsage} kit${kitUsage === 1 ? "" : "s"}`);
    throw new Error(
      `Cannot delete: this check item is used by ${parts.join(" and ")}`
    );
  }

  const result = await prisma.checkItem.delete({
    where: { id, organizationId },
  });
  await (await getConvexClient()).mutation(api.checkItems.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "checkItem",
    entityId: result.id,
    entityName: result.label,
    summary: `Deleted check item "${result.label}"`,
  });

  return serialize(result);
}

// ─── Model Check Items (assign check items to a model) ──────────────────────

export async function getModelCheckItems(modelId: string) {
  const { organizationId } = await requirePermission("checkItem", "read");

  return serialize(
    await prisma.modelCheckItem.findMany({
      where: { modelId, organizationId },
      include: { checkItem: true },
      orderBy: { sortOrder: "asc" },
    })
  );
}

export async function addCheckItemToModel(
  modelId: string,
  checkItemId: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "update"
  );

  // Get next sort order
  const maxSort = await prisma.modelCheckItem.aggregate({
    where: { modelId, organizationId },
    _max: { sortOrder: true },
  });

  const result = await prisma.modelCheckItem.create({
    data: {
      organizationId,
      modelId,
      checkItemId,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { checkItem: true, model: { select: { name: true } } },
  });
  await mirrorModelCheckItemCreate(result);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: modelId,
    entityName: result.model.name,
    summary: `Added check item "${result.checkItem.label}" to model "${result.model.name}"`,
  });

  return serialize(result);
}

export async function removeCheckItemFromModel(
  modelId: string,
  checkItemId: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "update"
  );

  const record = await prisma.modelCheckItem.findFirst({
    where: { modelId, checkItemId, organizationId },
    include: { checkItem: true, model: { select: { name: true } } },
  });

  if (!record) {
    throw new Error("Check item not assigned to this model");
  }

  await prisma.modelCheckItem.delete({
    where: { id: record.id },
  });
  await removeModelCheckItemFromConvex(record.id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: modelId,
    entityName: record.model.name,
    summary: `Removed check item "${record.checkItem.label}" from model "${record.model.name}"`,
  });

  return { success: true };
}

export async function reorderModelCheckItems(
  data: ReorderModelCheckItemsValues
) {
  const { organizationId } = await requirePermission("checkItem", "update");
  const parsed = reorderModelCheckItemsSchema.parse(data);

  await prisma.$transaction(
    parsed.orderedCheckItemIds.map((checkItemId, index) =>
      prisma.modelCheckItem.updateMany({
        where: { modelId: parsed.modelId, checkItemId, organizationId },
        data: { sortOrder: index },
      })
    )
  );
  await syncModelCheckItemsForModels([parsed.modelId]);

  return { success: true };
}

// ─── Bulk Model Check Items ──────────────────────────────────────────────────

export async function bulkAddCheckItemsToModels(
  modelIds: string[],
  checkItemIds: string[]
) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "update"
  );

  if (modelIds.length === 0 || checkItemIds.length === 0) {
    throw new Error("No models or check items selected");
  }

  // Find existing assignments + max sortOrder per model so we skip duplicates
  // and assign correct sequential sortOrder only for truly new items
  const [maxSorts, existing] = await Promise.all([
    prisma.modelCheckItem.groupBy({
      by: ["modelId"],
      where: { modelId: { in: modelIds }, organizationId },
      _max: { sortOrder: true },
    }),
    prisma.modelCheckItem.findMany({
      where: { modelId: { in: modelIds }, checkItemId: { in: checkItemIds }, organizationId },
      select: { modelId: true, checkItemId: true },
    }),
  ]);
  const sortMap = new Map(
    maxSorts.map((m) => [m.modelId, (m._max.sortOrder ?? -1) + 1])
  );
  const existingSet = new Set(
    existing.map((e) => `${e.modelId}:${e.checkItemId}`)
  );

  // Build rows only for items not already assigned — sequential sortOrder with no gaps
  const rows = modelIds.flatMap((modelId) => {
    const startSort = sortMap.get(modelId) ?? 0;
    let offset = 0;
    return checkItemIds
      .filter((checkItemId) => !existingSet.has(`${modelId}:${checkItemId}`))
      .map((checkItemId) => ({
        organizationId,
        modelId,
        checkItemId,
        sortOrder: startSort + offset++,
      }));
  });

  const result = await prisma.modelCheckItem.createMany({
    data: rows,
    skipDuplicates: true,
  });
  // createMany returns no ids, so re-read + upsert every assignment for the
  // affected models into Convex.
  await syncModelCheckItemsForModels(modelIds);

  // Fetch model names for audit log
  const models = await prisma.model.findMany({
    where: { id: { in: modelIds }, organizationId },
    select: { id: true, name: true },
  });
  const checkItems = await prisma.checkItem.findMany({
    where: { id: { in: checkItemIds }, organizationId },
    select: { id: true, label: true },
  });

  const checkLabels = checkItems.map((c) => c.label).join(", ");
  const modelNames = models.map((m) => m.name);

  for (const model of models) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "model",
      entityId: model.id,
      entityName: model.name,
      summary: `Bulk assigned check items [${checkLabels}] to model "${model.name}"`,
    });
  }

  return serialize({ count: result.count, modelNames });
}

// ─── Kit Check Items ──────────────────────────────────────────────────────────

export async function getKitCheckItems(kitId: string) {
  const { organizationId } = await requirePermission("checkItem", "read");

  return serialize(
    await prisma.kitCheckItem.findMany({
      where: { kitId, organizationId },
      include: { checkItem: true },
      orderBy: { sortOrder: "asc" },
    })
  );
}

export async function addCheckItemToKit(
  kitId: string,
  checkItemId: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "update"
  );

  const maxSort = await prisma.kitCheckItem.aggregate({
    where: { kitId, organizationId },
    _max: { sortOrder: true },
  });

  const result = await prisma.kitCheckItem.create({
    data: {
      organizationId,
      kitId,
      checkItemId,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { checkItem: true, kit: { select: { name: true } } },
  });
  await mirrorKitCheckItemCreate(result);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: kitId,
    entityName: result.kit.name,
    summary: `Added check item "${result.checkItem.label}" to kit "${result.kit.name}"`,
  });

  return serialize(result);
}

export async function removeCheckItemFromKit(
  kitId: string,
  checkItemId: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "update"
  );

  const record = await prisma.kitCheckItem.findFirst({
    where: { kitId, checkItemId, organizationId },
    include: { checkItem: true, kit: { select: { name: true } } },
  });

  if (!record) {
    throw new Error("Check item not assigned to this kit");
  }

  await prisma.kitCheckItem.delete({
    where: { id: record.id },
  });
  await removeKitCheckItemFromConvex(record.id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: kitId,
    entityName: record.kit.name,
    summary: `Removed check item "${record.checkItem.label}" from kit "${record.kit.name}"`,
  });

  return { success: true };
}

export async function reorderKitCheckItems(
  kitId: string,
  orderedCheckItemIds: string[]
) {
  const { organizationId } = await requirePermission("checkItem", "update");

  await prisma.$transaction(
    orderedCheckItemIds.map((checkItemId, index) =>
      prisma.kitCheckItem.updateMany({
        where: { kitId, checkItemId, organizationId },
        data: { sortOrder: index },
      })
    )
  );
  await syncKitCheckItemsForKit(kitId);

  return { success: true };
}
