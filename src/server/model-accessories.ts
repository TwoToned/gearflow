"use server";

import { createId } from "@paralleldrive/cuid2";
import { requirePermission } from "@/lib/org-context";
import { getModelById } from "@/lib/models-read";
import { getBulkAssetById } from "@/lib/assets-read";
import {
  modelBulkAccessorySchema,
  type ModelBulkAccessoryFormValues,
} from "@/lib/validations/asset";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { UserFacingError } from "@/lib/errors";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Model-level bulk accessories — "every asset of this model ships with N of
 * this bulk asset". When any asset of the model is added to a project (office
 * or warehouse-scan-time), the model-level accessories auto-expand alongside
 * the asset's own accessories, deduped by `bulkAssetId` with asset-level
 * winning. See line-items.ts:expandAccessoryChildren and
 * line-item-fulfillment.ts:expandAccessoriesForAsset.
 *
 * Always SHIPS_WITH (drawn from the live pool at prep). DEDICATED doesn't fit
 * here — it would require reserving N from the pool for every existing asset
 * of the model, which can drain the entire shelf in one click.
 */

/** Attach a bulk asset as a model-level default accessory. */
export async function addModelBulkAccessory(
  modelId: string,
  data: ModelBulkAccessoryFormValues,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "model",
    "update",
  );
  const parsed = modelBulkAccessorySchema.parse(data);

  const model = await getModelById(modelId);
  if (!model || model.organizationId !== organizationId) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Model not found",
      message: "The model no longer exists.",
    });
  }

  const bulkAsset = await getBulkAssetById(parsed.bulkAssetId);
  if (!bulkAsset || bulkAsset.organizationId !== organizationId) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Bulk asset not found",
      message: "The bulk accessory no longer exists.",
    });
  }

  const convex = await getConvexClient();

  // Check for duplicate and compute next sortOrder from the current Convex list.
  const existing = await convex.query(api.modelBulkAccessories.listByModelId, { modelId, organizationId });
  const dup = existing.find((a) => a.bulkAssetId === parsed.bulkAssetId);
  if (dup) {
    throw new UserFacingError({
      code: "ACCESSORY_DUPLICATE",
      title: "Already attached",
      message: `${bulkAsset.assetTag} is already a default accessory on this model. Edit the quantity instead.`,
    });
  }
  const sortOrder = existing.reduce((max, a) => Math.max(max, a.sortOrder ?? -1), -1) + 1;

  const id = createId();
  const now = Date.now();
  await convex.mutation(api.modelBulkAccessories.create, {
    id,
    organizationId,
    modelId,
    bulkAssetId: parsed.bulkAssetId,
    quantity: parsed.quantity,
    sortOrder,
    notes: parsed.notes,
    addedAt: now,
    addedById: userId,
  });

  const bulkAssetModel = bulkAsset.modelId ? await getModelById(bulkAsset.modelId) : null;

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: model.id,
    entityName: model.name,
    summary: `Added default accessory: ${parsed.quantity}× ${bulkAsset.assetTag} to model ${model.name}`,
    details: { accessory: { bulkAssetId: bulkAsset.id, quantity: parsed.quantity } },
  });

  return serialize({
    id,
    organizationId,
    modelId,
    bulkAssetId: parsed.bulkAssetId,
    quantity: parsed.quantity,
    sortOrder,
    notes: parsed.notes ?? null,
    addedAt: new Date(now),
    addedById: userId,
    bulkAsset: { ...bulkAsset, model: bulkAssetModel },
  });
}

/** Detach a model-level bulk accessory. Past project expansions are
 *  unaffected — they're already concrete line items. */
export async function removeModelBulkAccessory(
  modelId: string,
  accessoryId: string,
) {
  const { organizationId, userId, userName } = await requirePermission(
    "model",
    "update",
  );

  const convex = await getConvexClient();
  const acc = await convex.query(api.modelBulkAccessories.getById, { id: accessoryId });
  if (!acc || acc.organizationId !== organizationId || acc.modelId !== modelId) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Accessory not found",
      message: "That default accessory is not on this model.",
    });
  }

  await convex.mutation(api.modelBulkAccessories.remove, { id: accessoryId });

  const [parentModel, bulkAsset] = await Promise.all([
    getModelById(acc.modelId),
    getBulkAssetById(acc.bulkAssetId),
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: modelId,
    entityName: parentModel?.name ?? modelId,
    summary: `Removed default accessory: ${acc.quantity}× ${bulkAsset?.assetTag ?? acc.bulkAssetId}`,
    details: { accessory: { bulkAssetId: acc.bulkAssetId, quantity: acc.quantity } },
  });

  return serialize({ success: true });
}
