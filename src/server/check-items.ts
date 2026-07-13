"use server";

import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getModelById, getModelMap } from "@/lib/models-read";
import {
  getCheckItemsForOrg,
  getCheckItemById,
  getCheckItemUsageCounts,
  getModelCheckItemsForModel,
  getKitCheckItemsForKit,
  getModelAssignmentsForCheckItem,
} from "@/lib/check-items-read";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { createId } from "@paralleldrive/cuid2";
import {
  checkItemSchema,
  type CheckItemFormValues,
  reorderModelCheckItemsSchema,
  type ReorderModelCheckItemsValues,
} from "@/lib/validations/check-item";

// Check items are CONVEX-ONLY (Phase C config-leftover inversion): every
// create/update/delete writes the Convex `checkItems` doc directly (createId() +
// Date.now()) with no Prisma row. The model/kit assignment join tables were
// already Convex-only; check_record snapshot reads stay Prisma on purpose (see
// check-records.ts). Reads go through src/lib/check-items-read.ts. Clears (emptied
// optional fields) go through the custom api.checkItems.patchCheckItem mutation.
// See FEATUREDOCS/54.

// ─── Check Item Library ─────────────────────────────────────────────────────

export async function getCheckItems() {
  const { organizationId } = await requirePermission("checkItem", "read");

  // Convex reads: the check-item list + the usage counts (both join tables are
  // dual-written) replace the Prisma findMany + `_count` aggregate.
  const [items, counts] = await Promise.all([
    getCheckItemsForOrg(organizationId),
    getCheckItemUsageCounts(organizationId),
  ]);
  return serialize(
    items.map((item) => ({
      ...item,
      _count: counts[item.id] ?? { modelCheckItems: 0, checkRecords: 0 },
    }))
  );
}

/**
 * Per-check-item usage counts (checkItemId -> { modelCheckItems, checkRecords }).
 * Both the modelCheckItem and checkRecord join tables are dual-written, so the
 * counts come from Convex. Used by the reactive check-item library, which
 * subscribes to the list via Convex and merges these (non-reactive) counts in.
 */
export async function getCheckItemCounts(): Promise<Record<string, { modelCheckItems: number; checkRecords: number }>> {
  const { organizationId } = await getOrgContext();
  return serialize(await getCheckItemUsageCounts(organizationId));
}

export async function getCheckItem(id: string) {
  const { organizationId } = await requirePermission("checkItem", "read");

  // Convex reads: the check item itself + its model assignments (replacing the
  // Prisma findFirst with `_count` + `modelCheckItems` include).
  const [item, assignments, counts] = await Promise.all([
    getCheckItemById(organizationId, id),
    getModelAssignmentsForCheckItem(organizationId, id),
    getCheckItemUsageCounts(organizationId),
  ]);
  if (!item) {
    throw new Error("Check item not found");
  }

  // Model name is a cross-domain join — Model lives in Convex too.
  const models = await Promise.all(assignments.map((m) => getModelById(m.modelId)));
  const modelNameMap = new Map<string, { id: string; name: string }>();
  for (const m of models) if (m) modelNameMap.set(m.id, { id: m.id, name: m.name });
  const enriched = {
    ...item,
    _count: counts[item.id] ?? { modelCheckItems: 0, checkRecords: 0 },
    modelCheckItems: assignments
      .map((m) => ({ ...m, model: modelNameMap.get(m.modelId) ?? null }))
      .sort((a, b) => (a.model?.name ?? "").localeCompare(b.model?.name ?? "")),
  };

  return serialize(enriched);
}

export async function createCheckItem(data: CheckItemFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "create"
  );
  const parsed = checkItemSchema.parse(data);

  const id = createId();
  const now = Date.now();
  await (await getConvexClient()).mutation(api.checkItems.create, {
    id,
    organizationId,
    label: parsed.label,
    description: parsed.description || undefined,
    type: parsed.type ?? "PASS_FAIL",
    category: parsed.category || undefined,
    measurementUnit: parsed.measurementUnit || undefined,
    measurementMin: parsed.measurementMin ?? undefined,
    measurementMax: parsed.measurementMax ?? undefined,
    dropdownOptions: parsed.dropdownOptions ?? undefined,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await getCheckItemById(organizationId, id);
  if (!result) throw new Error("Failed to load check item after create");

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

  // Org-scoped existence guard (replaces Prisma `update where {id, organizationId}`).
  const existing = await getCheckItemById(organizationId, id);
  if (!existing) throw new Error("Check item not found");

  // Build `set` (present values) + `clear` (omitted optional fields). The form
  // submits the full object, so an absent optional means "cleared" (e.g. switching
  // the type drops measurement/dropdown fields).
  const set: Record<string, unknown> = {
    label: parsed.label,
    type: parsed.type ?? "PASS_FAIL",
    updatedAt: Date.now(),
  };
  const clear: string[] = [];
  const nullableFields = {
    description: parsed.description,
    category: parsed.category,
    measurementUnit: parsed.measurementUnit,
    measurementMin: parsed.measurementMin,
    measurementMax: parsed.measurementMax,
    dropdownOptions: parsed.dropdownOptions,
  } as const;
  for (const [key, value] of Object.entries(nullableFields)) {
    if (value === undefined || value === null || value === "") clear.push(key);
    else set[key] = value;
  }

  await (await getConvexClient()).mutation(api.checkItems.patchCheckItem, {
    id,
    set,
    clear,
  });

  const result = await getCheckItemById(organizationId, id);
  if (!result) throw new Error("Failed to load check item after update");

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

  // Block delete if in use by any model or kit (Convex-only reads)
  const convexForGuard = await getConvexClient();
  const [modelRows, kitRows] = await Promise.all([
    convexForGuard.query(api.modelCheckItems.listByCheckItemId, { orgId: organizationId, checkItemId: id }),
    convexForGuard.query(api.kitCheckItems.listByCheckItemId, { orgId: organizationId, checkItemId: id }),
  ]);
  const modelUsage = modelRows.length;
  const kitUsage = kitRows.length;

  if (modelUsage > 0 || kitUsage > 0) {
    const parts: string[] = [];
    if (modelUsage > 0) parts.push(`${modelUsage} model${modelUsage === 1 ? "" : "s"}`);
    if (kitUsage > 0) parts.push(`${kitUsage} kit${kitUsage === 1 ? "" : "s"}`);
    throw new Error(
      `Cannot delete: this check item is used by ${parts.join(" and ")}`
    );
  }

  // Org-scoped existence guard (replaces Prisma `delete where {id, organizationId}`).
  const result = await getCheckItemById(organizationId, id);
  if (!result) throw new Error("Check item not found");
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

  return serialize(await getModelCheckItemsForModel(organizationId, modelId));
}

export async function addCheckItemToModel(
  modelId: string,
  checkItemId: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "update"
  );

  const convex = await getConvexClient();
  const existing = await convex.query(api.modelCheckItems.listByModelId, { orgId: organizationId, modelId });
  const maxSortOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder ?? -1), -1);
  const newId = createId();
  const now = Date.now();
  await convex.mutation(api.modelCheckItems.createIfMissing, {
    id: newId,
    organizationId,
    modelId,
    checkItemId,
    sortOrder: maxSortOrder + 1,
    createdAt: now,
  });
  const [checkItem, model] = await Promise.all([
    getCheckItemById(organizationId, checkItemId),
    getModelById(modelId),
  ]);
  const result = { id: newId, organizationId, modelId, checkItemId, sortOrder: maxSortOrder + 1, createdAt: new Date(now), checkItem };
  const modelName = model?.name ?? modelId;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: modelId,
    entityName: modelName,
    summary: `Added check item "${checkItem?.label ?? checkItemId}" to model "${modelName}"`,
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

  const convex = await getConvexClient();
  const record = await convex.query(api.modelCheckItems.getByModelAndCheckItem, { orgId: organizationId, modelId, checkItemId });

  if (!record) {
    throw new Error("Check item not assigned to this model");
  }

  const [, model, checkItem] = await Promise.all([
    convex.mutation(api.modelCheckItems.remove, { id: record.id }),
    getModelById(modelId),
    getCheckItemById(organizationId, checkItemId),
  ]);
  const modelName = model?.name ?? modelId;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: modelId,
    entityName: modelName,
    summary: `Removed check item "${checkItem?.label ?? checkItemId}" from model "${modelName}"`,
  });

  return { success: true };
}

export async function reorderModelCheckItems(
  data: ReorderModelCheckItemsValues
) {
  const { organizationId } = await requirePermission("checkItem", "update");
  const parsed = reorderModelCheckItemsSchema.parse(data);

  const convex = await getConvexClient();
  // Resolve (model, checkItem) → row id ONCE via listByModel, then patch sortOrder for
  // all rows in a single array mutation (was one read + one update round-trip per item).
  const rows = await convex.query(api.modelCheckItems.listByModel, { orgId: organizationId, modelId: parsed.modelId });
  const rowIdByCheckItem = new Map(rows.map((r) => [r.checkItemId, r.id]));
  // Keep each row's ORIGINAL position (index in orderedCheckItemIds) as its sortOrder,
  // so a dropped/unresolved id doesn't compress the survivors' positions.
  const items = parsed.orderedCheckItemIds
    .map((checkItemId, sortOrder) => ({ id: rowIdByCheckItem.get(checkItemId), sortOrder }))
    .filter((r): r is { id: string; sortOrder: number } => r.id != null);
  await convex.mutation(api.modelCheckItems.reorderMany, { orgId: organizationId, items });

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

  // Fetch existing assignments per model from Convex to compute maxSort + dedup
  const convex = await getConvexClient();
  const existingByModel = await Promise.all(
    modelIds.map((modelId) => convex.query(api.modelCheckItems.listByModelId, { orgId: organizationId, modelId }))
  );
  const sortMap = new Map<string, number>();
  const existingSet = new Set<string>();
  for (let i = 0; i < modelIds.length; i++) {
    const modelId = modelIds[i];
    const rows = existingByModel[i];
    sortMap.set(modelId, (rows.reduce((max, r) => Math.max(max, r.sortOrder ?? -1), -1)) + 1);
    for (const r of rows) existingSet.add(`${r.modelId}:${r.checkItemId}`);
  }

  // Build the (deduped) rows to create in memory, then insert them all in ONE array
  // mutation (was one createIfMissing round-trip per model×checkItem pair).
  const createdAt = Date.now();
  const rows: { id: string; modelId: string; checkItemId: string; sortOrder: number; createdAt: number }[] = [];
  for (const modelId of modelIds) {
    let offset = sortMap.get(modelId) ?? 0;
    for (const checkItemId of checkItemIds) {
      if (existingSet.has(`${modelId}:${checkItemId}`)) continue;
      rows.push({ id: createId(), modelId, checkItemId, sortOrder: offset++, createdAt });
    }
  }
  const { created } =
    rows.length > 0
      ? await convex.mutation(api.modelCheckItems.createManyIfMissing, { organizationId, rows })
      : { created: 0 };
  const result = { count: created };

  // Model lives in Convex — fetch names for audit log via map.
  const convexModelMap = await getModelMap(organizationId);
  const models = modelIds.map((id) => ({ id, name: convexModelMap.get(id)?.name ?? id }));
  // check_item is Convex-only — read labels from the org's Convex check items.
  const idSet = new Set(checkItemIds);
  const allCheckItems = await getCheckItemsForOrg(organizationId);
  const checkItems = allCheckItems.filter((c) => idSet.has(c.id));

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

  return serialize(await getKitCheckItemsForKit(organizationId, kitId));
}

export async function addCheckItemToKit(
  kitId: string,
  checkItemId: string
) {
  const { organizationId, userId, userName } = await requirePermission(
    "checkItem",
    "update"
  );

  const convex = await getConvexClient();
  const existingKitItems = await convex.query(api.kitCheckItems.listByKitId, { orgId: organizationId, kitId });
  const maxSortOrder = existingKitItems.reduce((max, r) => Math.max(max, r.sortOrder ?? -1), -1);
  const newId = createId();
  const now = Date.now();
  await convex.mutation(api.kitCheckItems.createIfMissing, {
    id: newId,
    organizationId,
    kitId,
    checkItemId,
    sortOrder: maxSortOrder + 1,
    createdAt: now,
  });
  const [checkItem, kit] = await Promise.all([
    getCheckItemById(organizationId, checkItemId),
    (await getConvexClient()).query(api.kits.getById, { id: kitId }),
  ]);
  const result = { id: newId, organizationId, kitId, checkItemId, sortOrder: maxSortOrder + 1, createdAt: new Date(now), checkItem, kit };

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: kitId,
    entityName: kit?.name ?? kitId,
    summary: `Added check item "${checkItem?.label ?? checkItemId}" to kit "${kit?.name ?? kitId}"`,
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

  const convex = await getConvexClient();
  const record = await convex.query(api.kitCheckItems.getByKitAndCheckItem, { orgId: organizationId, kitId, checkItemId });

  if (!record) {
    throw new Error("Check item not assigned to this kit");
  }

  const [, checkItem, kit] = await Promise.all([
    convex.mutation(api.kitCheckItems.remove, { id: record.id }),
    getCheckItemById(organizationId, checkItemId),
    convex.query(api.kits.getById, { id: kitId }),
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "kit",
    entityId: kitId,
    entityName: kit?.name ?? kitId,
    summary: `Removed check item "${checkItem?.label ?? checkItemId}" from kit "${kit?.name ?? kitId}"`,
  });

  return { success: true };
}

export async function reorderKitCheckItems(
  kitId: string,
  orderedCheckItemIds: string[]
) {
  const { organizationId } = await requirePermission("checkItem", "update");

  const convex = await getConvexClient();
  // Resolve (kit, checkItem) → row id ONCE via listByKitId, then patch sortOrder for all
  // rows in a single array mutation (was one read + one update round-trip per item).
  const rows = await convex.query(api.kitCheckItems.listByKitId, { orgId: organizationId, kitId });
  const rowIdByCheckItem = new Map(rows.map((r) => [r.checkItemId, r.id]));
  // Keep each row's ORIGINAL position as its sortOrder (no compression on drop).
  const items = orderedCheckItemIds
    .map((checkItemId, sortOrder) => ({ id: rowIdByCheckItem.get(checkItemId), sortOrder }))
    .filter((r): r is { id: string; sortOrder: number } => r.id != null);
  await convex.mutation(api.kitCheckItems.reorderMany, { orgId: organizationId, items });

  return { success: true };
}
