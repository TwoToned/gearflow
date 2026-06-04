"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/org-context";
import {
  modelBulkAccessorySchema,
  type ModelBulkAccessoryFormValues,
} from "@/lib/validations/asset";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { UserFacingError } from "@/lib/errors";

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

  const model = await prisma.model.findUnique({
    where: { id: modelId, organizationId },
    select: { id: true, name: true },
  });
  if (!model) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Model not found",
      message: "The model no longer exists.",
    });
  }

  const bulkAsset = await prisma.bulkAsset.findUnique({
    where: { id: parsed.bulkAssetId, organizationId },
    select: { id: true, assetTag: true },
  });
  if (!bulkAsset) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Bulk asset not found",
      message: "The bulk accessory no longer exists.",
    });
  }

  const maxSort = await prisma.modelBulkAccessory.aggregate({
    where: { modelId, organizationId },
    _max: { sortOrder: true },
  });

  // The (modelId, bulkAssetId) unique constraint enforces "one row per
  // bulk-on-model" — surface a friendly error if the operator double-adds.
  let row;
  try {
    row = await prisma.modelBulkAccessory.create({
      data: {
        organizationId,
        modelId,
        bulkAssetId: parsed.bulkAssetId,
        quantity: parsed.quantity,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        notes: parsed.notes,
        addedById: userId,
      },
      include: { bulkAsset: { include: { model: { select: { name: true } } } } },
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      throw new UserFacingError({
        code: "ACCESSORY_DUPLICATE",
        title: "Already attached",
        message: `${bulkAsset.assetTag} is already a default accessory on this model. Edit the quantity instead.`,
      });
    }
    throw e;
  }

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

  return serialize(row);
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

  const acc = await prisma.modelBulkAccessory.findUnique({
    where: { id: accessoryId },
    select: {
      id: true,
      organizationId: true,
      modelId: true,
      quantity: true,
      bulkAsset: { select: { id: true, assetTag: true } },
      model: { select: { name: true } },
    },
  });
  if (
    !acc ||
    acc.organizationId !== organizationId ||
    acc.modelId !== modelId
  ) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Accessory not found",
      message: "That default accessory is not on this model.",
    });
  }

  await prisma.modelBulkAccessory.delete({ where: { id: accessoryId } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "model",
    entityId: modelId,
    entityName: acc.model.name,
    summary: `Removed default accessory: ${acc.quantity}× ${acc.bulkAsset.assetTag}`,
    details: { accessory: { bulkAssetId: acc.bulkAsset.id, quantity: acc.quantity } },
  });

  return serialize({ success: true });
}
