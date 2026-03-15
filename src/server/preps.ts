"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { createPrepSchema, updatePrepSchema } from "@/lib/validations/prep";

// ---------------------------------------------------------------------------
// Includes
// ---------------------------------------------------------------------------

const PREP_INCLUDE = {
  containerAsset: { include: { model: true } },
  items: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
      kit: { select: { id: true, assetTag: true, name: true } },
      lineItem: true,
      addedBy: { select: { id: true, name: true } },
    },
  },
  preparedBy: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, projectNumber: true } },
} as const;

// ---------------------------------------------------------------------------
// 1. CRUD
// ---------------------------------------------------------------------------

export async function createPrep(data: {
  projectId: string;
  name: string;
  containerAssetId?: string | null;
  notes?: string | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");
  const parsed = createPrepSchema.parse(data);

  // If a container asset is specified, validate it exists and belongs to org
  if (parsed.containerAssetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: parsed.containerAssetId, organizationId },
    });
    if (!asset) throw new Error("Container asset not found");

    // Check it's not already used as a container for another active prep
    const existingPrep = await prisma.prep.findFirst({
      where: {
        containerAssetId: parsed.containerAssetId,
        status: { notIn: ["UNPACKED", "CANCELLED"] },
      },
    });
    if (existingPrep) throw new Error("This asset is already a container for another active prep");
  }

  const prep = await prisma.prep.create({
    data: {
      organizationId,
      projectId: parsed.projectId,
      name: parsed.name,
      containerAssetId: parsed.containerAssetId ?? null,
      notes: parsed.notes ?? null,
      status: "PACKING",
      preparedById: userId,
    },
    include: PREP_INCLUDE,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "prep",
    entityId: prep.id,
    entityName: prep.name,
    summary: `Created prep "${prep.name}"`,
    projectId: parsed.projectId,
    details: { containerAssetId: parsed.containerAssetId },
  });

  return serialize(prep);
}

export async function updatePrep(id: string, data: {
  name?: string;
  notes?: string | null;
}) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");
  const parsed = updatePrepSchema.parse(data);

  // Verify prep belongs to this org before updating
  const existing = await prisma.prep.findFirst({ where: { id, organizationId } });
  if (!existing) throw new Error("Not found");

  const prep = await prisma.prep.update({
    where: { id },
    data: parsed,
    include: PREP_INCLUDE,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "prep",
    entityId: prep.id,
    entityName: prep.name,
    summary: `Updated prep "${prep.name}"`,
    projectId: prep.projectId,
  });

  return serialize(prep);
}

export async function deletePrep(id: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");

  const prep = await prisma.prep.findFirst({
    where: { id, organizationId },
    include: { items: true },
  });
  if (!prep) throw new Error("Prep not found");
  if (prep.status === "CHECKED_OUT") throw new Error("Cannot delete a prep that is currently deployed");

  // Reverse all asset-to-line-item assignments made during addPrepItem
  for (const item of prep.items) {
    if (item.assetId && item.lineItemId) {
      await prisma.projectLineItem.update({
        where: { id: item.lineItemId },
        data: { assetId: null },
      });
    }
  }

  await prisma.prep.delete({ where: { id } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "prep",
    entityId: prep.id,
    entityName: prep.name,
    summary: `Deleted prep "${prep.name}"`,
    projectId: prep.projectId,
  });
}

export async function getProjectPreps(projectId: string) {
  const { organizationId } = await getOrgContext();

  const preps = await prisma.prep.findMany({
    where: { organizationId, projectId },
    include: PREP_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  return serialize(preps);
}

export async function getPrepById(id: string) {
  const { organizationId } = await getOrgContext();

  const prep = await prisma.prep.findFirst({
    where: { id, organizationId },
    include: PREP_INCLUDE,
  });

  if (!prep) throw new Error("Prep not found");
  return serialize(prep);
}

// ---------------------------------------------------------------------------
// 2. Packing — add/remove items
// ---------------------------------------------------------------------------

export async function addPrepItem(prepId: string, assetTag: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");

  const prep = await prisma.prep.findFirst({
    where: { id: prepId, organizationId },
  });
  if (!prep) throw new Error("Prep not found");
  if (prep.status !== "PACKING") throw new Error("Prep is not in packing state");

  // Look up asset by tag
  const asset = await prisma.asset.findUnique({
    where: { organizationId_assetTag: { organizationId, assetTag } },
    include: { model: true },
  });

  if (!asset) {
    // Try bulk asset
    const bulkAsset = await prisma.bulkAsset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
      include: { model: true },
    });
    if (bulkAsset) {
      return serialize(await addBulkPrepItemInternal(prep, bulkAsset, 1, organizationId, userId, userName));
    }

    // Try kit
    const kit = await prisma.kit.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
    });
    if (kit) {
      return serialize(await addKitPrepItemInternal(prep, kit, organizationId, userId, userName));
    }

    throw new Error("Asset not found");
  }

  // Validate: asset must be AVAILABLE
  if (asset.status !== "AVAILABLE") {
    throw new Error(`Asset ${asset.assetTag} is ${asset.status.replace("_", " ").toLowerCase()}`);
  }

  // Check asset not already in another active prep
  const existingPrepItem = await prisma.prepItem.findFirst({
    where: {
      assetId: asset.id,
      prep: { status: { notIn: ["UNPACKED", "CANCELLED"] } },
    },
  });
  if (existingPrepItem) {
    throw new Error(`Asset ${asset.assetTag} is already in another prep`);
  }

  // Find a matching line item on the project for this asset's model.
  // IMPORTANT: Skip line items already claimed by another PrepItem in this prep
  // so that multiple assets of the same model get unique line items.
  const lineItem = await prisma.projectLineItem.findFirst({
    where: {
      projectId: prep.projectId,
      organizationId,
      modelId: asset.modelId,
      status: { notIn: ["CANCELLED", "CHECKED_OUT"] },
      isKitChild: false,
      isPrepChild: false,
      // Exclude line items already linked by a PrepItem in THIS prep
      prepItems: { none: { prepId } },
    },
    orderBy: { sortOrder: "asc" },
  });

  // Asset model MUST be on the project — error if not
  if (!lineItem) {
    throw new Error(`${asset.model.name} (${asset.assetTag}) is not required on this project`);
  }

  // Get next sort order
  const maxSort = await prisma.prepItem.aggregate({
    where: { prepId },
    _max: { sortOrder: true },
  });

  // Assign the specific asset to the line item (like deploy does)
  await prisma.projectLineItem.update({
    where: { id: lineItem.id },
    data: { assetId: asset.id },
  });

  const item = await prisma.prepItem.create({
    data: {
      prepId,
      assetId: asset.id,
      lineItemId: lineItem.id,
      addedById: userId,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: {
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
      lineItem: true,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "prep",
    entityId: prep.id,
    entityName: prep.name,
    summary: `Added ${asset.assetTag} to prep "${prep.name}"`,
    projectId: prep.projectId,
    assetId: asset.id,
  });

  return serialize({
    item,
    matchedLineItem: true,
    assetName: asset.model.name,
    assetTag: asset.assetTag,
  });
}

async function addBulkPrepItemInternal(
  prep: { id: string; projectId: string; name: string },
  bulkAsset: { id: string; modelId: string; model: { name: string }; assetTag: string },
  quantity: number,
  organizationId: string,
  userId: string,
  userName: string,
) {
  // Find a matching bulk line item on the project
  const lineItem = await prisma.projectLineItem.findFirst({
    where: {
      projectId: prep.projectId,
      organizationId,
      bulkAssetId: bulkAsset.id,
      status: { notIn: ["CANCELLED", "CHECKED_OUT"] },
      isPrepChild: false,
      isKitChild: false,
    },
    orderBy: { sortOrder: "asc" },
  });

  // Bulk asset MUST be on the project — error if not
  if (!lineItem) {
    throw new Error(`${bulkAsset.model.name} (${bulkAsset.assetTag}) is not required on this project`);
  }

  // Check if we already have a PrepItem for this bulk asset in this prep — if so, increment qty
  const existingItem = await prisma.prepItem.findFirst({
    where: { prepId: prep.id, bulkAssetId: bulkAsset.id },
  });

  let item;
  if (existingItem) {
    // Increment quantity on existing entry
    item = await prisma.prepItem.update({
      where: { id: existingItem.id },
      data: { quantity: existingItem.quantity + quantity },
      include: {
        asset: { include: { model: true } },
        bulkAsset: { include: { model: true } },
        lineItem: true,
      },
    });
  } else {
    const maxSort = await prisma.prepItem.aggregate({
      where: { prepId: prep.id },
      _max: { sortOrder: true },
    });

    item = await prisma.prepItem.create({
      data: {
        prepId: prep.id,
        bulkAssetId: bulkAsset.id,
        quantity,
        lineItemId: lineItem.id,
        addedById: userId,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
      include: {
        asset: { include: { model: true } },
        bulkAsset: { include: { model: true } },
        lineItem: true,
      },
    });
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "prep",
    entityId: prep.id,
    entityName: prep.name,
    summary: `Added ${quantity}x ${bulkAsset.model.name} to prep "${prep.name}"`,
    projectId: prep.projectId,
  });

  return {
    item,
    matchedLineItem: true,
    assetName: bulkAsset.model.name,
    assetTag: bulkAsset.assetTag,
  };
}

async function addKitPrepItemInternal(
  prep: { id: string; projectId: string; name: string },
  kit: { id: string; assetTag: string; name: string },
  organizationId: string,
  userId: string,
  userName: string,
) {
  // Check kit is available
  const fullKit = await prisma.kit.findUnique({
    where: { id: kit.id },
    select: { status: true },
  });
  if (fullKit && fullKit.status !== "AVAILABLE") {
    throw new Error(`Kit ${kit.assetTag} is ${fullKit.status.replace("_", " ").toLowerCase()}`);
  }

  // Check kit not already in another active prep
  const existingPrepItem = await prisma.prepItem.findFirst({
    where: {
      kitId: kit.id,
      prep: { status: { notIn: ["UNPACKED", "CANCELLED"] } },
    },
  });
  if (existingPrepItem) {
    throw new Error(`Kit ${kit.assetTag} is already in another prep`);
  }

  // Find the kit's line item on the project
  const lineItem = await prisma.projectLineItem.findFirst({
    where: {
      projectId: prep.projectId,
      organizationId,
      kitId: kit.id,
      isKitChild: false,
      status: { notIn: ["CANCELLED", "CHECKED_OUT"] },
    },
    orderBy: { sortOrder: "asc" },
  });

  if (!lineItem) {
    throw new Error(`Kit "${kit.name}" (${kit.assetTag}) is not on this project`);
  }

  const maxSort = await prisma.prepItem.aggregate({
    where: { prepId: prep.id },
    _max: { sortOrder: true },
  });

  const item = await prisma.prepItem.create({
    data: {
      prepId: prep.id,
      kitId: kit.id,
      lineItemId: lineItem.id,
      addedById: userId,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: {
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
      kit: { select: { id: true, assetTag: true, name: true } },
      lineItem: true,
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "prep",
    entityId: prep.id,
    entityName: prep.name,
    summary: `Added kit "${kit.name}" (${kit.assetTag}) to prep "${prep.name}"`,
    projectId: prep.projectId,
    kitId: kit.id,
  });

  return {
    item,
    matchedLineItem: true,
    assetName: kit.name,
    assetTag: kit.assetTag,
  };
}

export async function addBulkPrepItem(prepId: string, bulkAssetId: string, quantity: number) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");

  const prep = await prisma.prep.findFirst({ where: { id: prepId, organizationId } });
  if (!prep) throw new Error("Prep not found");
  if (prep.status !== "PACKING") throw new Error("Prep is not in packing state");

  const bulkAsset = await prisma.bulkAsset.findFirst({
    where: { id: bulkAssetId, organizationId },
    include: { model: true },
  });
  if (!bulkAsset) throw new Error("Bulk asset not found");

  const result = await addBulkPrepItemInternal(prep, bulkAsset, quantity, organizationId, userId, userName);
  return serialize(result);
}

export async function removePrepItem(itemId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");

  const item = await prisma.prepItem.findUnique({
    where: { id: itemId },
    include: {
      prep: true,
      asset: { include: { model: true } },
      bulkAsset: { include: { model: true } },
      kit: { select: { id: true, assetTag: true, name: true } },
    },
  });
  if (!item) throw new Error("Prep item not found");
  if (item.prep.organizationId !== organizationId) throw new Error("Not found");
  if (item.prep.status !== "PACKING") throw new Error("Prep is not in packing state");

  // Unassign the asset from the line item (reverse what addPrepItem did)
  if (item.assetId && item.lineItemId) {
    await prisma.projectLineItem.update({
      where: { id: item.lineItemId },
      data: { assetId: null },
    });
  }

  await prisma.prepItem.delete({ where: { id: itemId } });

  const assetName = item.kit?.name || item.asset?.model.name || item.bulkAsset?.model.name || "Unknown";
  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "prep",
    entityId: item.prep.id,
    entityName: item.prep.name,
    summary: `Removed ${assetName} from prep "${item.prep.name}"`,
    projectId: item.prep.projectId,
  });
}

// ---------------------------------------------------------------------------
// 3. Status transitions
// ---------------------------------------------------------------------------

export async function markPrepPacked(id: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");

  const prep = await prisma.prep.findFirst({ where: { id, organizationId } });
  if (!prep) throw new Error("Prep not found");
  if (prep.status !== "PACKING") throw new Error("Prep must be in PACKING state");

  const updated = await prisma.prep.update({
    where: { id },
    data: { status: "PACKED", preparedAt: new Date(), preparedById: userId },
    include: PREP_INCLUDE,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "STATUS_CHANGE",
    entityType: "prep",
    entityId: id,
    entityName: prep.name,
    summary: `Marked prep "${prep.name}" as packed`,
    projectId: prep.projectId,
  });

  return serialize(updated);
}

export async function reopenPrep(id: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");

  const prep = await prisma.prep.findFirst({ where: { id, organizationId } });
  if (!prep) throw new Error("Prep not found");
  if (prep.status !== "PACKED") throw new Error("Prep must be in PACKED state to reopen");

  const updated = await prisma.prep.update({
    where: { id },
    data: { status: "PACKING", preparedAt: null },
    include: PREP_INCLUDE,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "STATUS_CHANGE",
    entityType: "prep",
    entityId: id,
    entityName: prep.name,
    summary: `Reopened prep "${prep.name}" for packing`,
    projectId: prep.projectId,
  });

  return serialize(updated);
}

// ---------------------------------------------------------------------------
// 4. Checkout / Check-in / Unpack
// ---------------------------------------------------------------------------

export async function checkOutPrep(prepId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const result = await prisma.$transaction(async (tx) => {
    const prep = await tx.prep.findFirst({
      where: { id: prepId, organizationId },
      include: {
        items: { include: { asset: true, bulkAsset: true, kit: true, lineItem: true } },
      },
    });
    if (!prep) throw new Error("Prep not found");
    if (prep.status !== "PACKED" && prep.status !== "PACKING") {
      throw new Error("Prep must be in PACKED or PACKING state to deploy");
    }

    const project = await tx.project.findUnique({
      where: { id: prep.projectId },
      select: { locationId: true },
    });
    const projectLocationId = project?.locationId || null;

    // --- Create the prep parent line item ---
    const maxSort = await tx.projectLineItem.aggregate({
      where: { projectId: prep.projectId, organizationId },
      _max: { sortOrder: true },
    });
    let nextSort = (maxSort._max.sortOrder ?? -1) + 1;

    const parentItem = await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId: prep.projectId,
        type: "EQUIPMENT",
        prepId: prep.id,
        isPrepChild: false,
        description: prep.name,
        quantity: 1,
        sortOrder: nextSort++,
        status: "CHECKED_OUT",
        checkedOutQuantity: 1,
        checkedOutAt: new Date(),
        checkedOutById: userId,
      },
    });

    // Check out the container asset itself (if it's a tracked asset)
    if (prep.containerAssetId) {
      const containerAsset = await tx.asset.findUnique({ where: { id: prep.containerAssetId } });
      if (containerAsset && containerAsset.status === "AVAILABLE") {
        await tx.asset.update({
          where: { id: prep.containerAssetId },
          data: {
            status: "CHECKED_OUT",
            ...(projectLocationId && { locationId: projectLocationId }),
          },
        });
      }
    }

    // --- Re-parent all prep items as children of the parent line item ---
    for (const item of prep.items) {
      if (item.kitId && item.kit) {
        // Kit — re-parent the kit's parent line item under the prep parent, then deploy kit contents
        const kitLineItem = item.lineItemId
          ? await tx.projectLineItem.findUnique({ where: { id: item.lineItemId } })
          : null;

        if (kitLineItem) {
          await tx.projectLineItem.update({
            where: { id: kitLineItem.id },
            data: {
              isPrepChild: true,
              parentLineItemId: parentItem.id,
              status: "CHECKED_OUT",
              checkedOutQuantity: 1,
              checkedOutAt: new Date(),
              checkedOutById: userId,
            },
          });
          // Update all kit child line items
          await tx.projectLineItem.updateMany({
            where: { parentLineItemId: kitLineItem.id, organizationId },
            data: { status: "CHECKED_OUT", checkedOutQuantity: 1, checkedOutAt: new Date(), checkedOutById: userId },
          });
        }

        // Update kit status and location
        await tx.kit.update({
          where: { id: item.kitId },
          data: {
            status: "CHECKED_OUT",
            ...(projectLocationId && { locationId: projectLocationId }),
          },
        });

        // Update all serialized assets inside the kit
        const kitItems = await tx.kitSerializedItem.findMany({ where: { kitId: item.kitId } });
        for (const ki of kitItems) {
          await tx.asset.update({
            where: { id: ki.assetId },
            data: {
              status: "CHECKED_OUT",
              ...(projectLocationId && { locationId: projectLocationId }),
            },
          });
        }
      } else if (item.assetId && item.asset) {
        // Serialized asset — re-parent the line item and mark as checked out
        if (item.asset.status === "AVAILABLE") {
          await tx.asset.update({
            where: { id: item.assetId },
            data: {
              status: "CHECKED_OUT",
              ...(projectLocationId && { locationId: projectLocationId }),
            },
          });
        }

        if (item.lineItemId) {
          await tx.projectLineItem.update({
            where: { id: item.lineItemId },
            data: {
              isPrepChild: true,
              parentLineItemId: parentItem.id,
              status: "CHECKED_OUT",
              checkedOutQuantity: 1,
              checkedOutAt: new Date(),
              checkedOutById: userId,
            },
          });
        }
      } else if (item.bulkAssetId && item.lineItemId) {
        // Bulk asset — split the line item if partial quantity
        const lineItem = await tx.projectLineItem.findUnique({ where: { id: item.lineItemId } });
        if (lineItem) {
          if (item.quantity < lineItem.quantity) {
            // Partial split: reduce original, create child for prep quantity
            await tx.projectLineItem.update({
              where: { id: lineItem.id },
              data: { quantity: lineItem.quantity - item.quantity },
            });
            const splitChild = await tx.projectLineItem.create({
              data: {
                organizationId,
                projectId: prep.projectId,
                type: "EQUIPMENT",
                modelId: lineItem.modelId,
                bulkAssetId: lineItem.bulkAssetId,
                description: lineItem.description,
                quantity: item.quantity,
                unitPrice: lineItem.unitPrice,
                pricingType: lineItem.pricingType,
                duration: lineItem.duration,
                isPrepChild: true,
                parentLineItemId: parentItem.id,
                sortOrder: nextSort++,
                status: "CHECKED_OUT",
                checkedOutQuantity: item.quantity,
                checkedOutAt: new Date(),
                checkedOutById: userId,
              },
            });
            // Update PrepItem to point to the new split child
            await tx.prepItem.update({
              where: { id: item.id },
              data: { lineItemId: splitChild.id },
            });
          } else {
            // Full quantity — re-parent the existing line item
            await tx.projectLineItem.update({
              where: { id: lineItem.id },
              data: {
                isPrepChild: true,
                parentLineItemId: parentItem.id,
                status: "CHECKED_OUT",
                checkedOutQuantity: item.quantity,
                checkedOutAt: new Date(),
                checkedOutById: userId,
              },
            });
          }
        }
      }
    }

    // Create scan log
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: prep.containerAssetId,
        projectId: prep.projectId,
        action: "CHECK_OUT",
        scannedById: userId,
        notes: `Prep "${prep.name}" deployed with ${prep.items.length} items`,
      },
    });

    // Update prep status
    const updated = await tx.prep.update({
      where: { id: prepId },
      data: { status: "CHECKED_OUT", checkedOutAt: new Date() },
    });

    return updated;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_OUT",
    entityType: "prep",
    entityId: prepId,
    entityName: result.name,
    summary: `Deployed prep "${result.name}" with all contents`,
    projectId: result.projectId,
  });

  return serialize(result);
}

export async function checkInPrep(
  prepId: string,
  conditions?: Array<{ itemId: string; returnCondition: "GOOD" | "DAMAGED" | "MISSING" }>,
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  const result = await prisma.$transaction(async (tx) => {
    const prep = await tx.prep.findFirst({
      where: { id: prepId, organizationId },
      include: {
        items: { include: { asset: true, bulkAsset: true, kit: true, lineItem: true } },
      },
    });
    if (!prep) throw new Error("Prep not found");
    if (prep.status !== "CHECKED_OUT") throw new Error("Prep must be deployed to return");

    const defaultLocation = await tx.location.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    const defaultLocationId = defaultLocation?.id || null;

    const conditionMap = new Map(conditions?.map((c) => [c.itemId, c.returnCondition]) || []);

    // Find the prep parent line item
    const prepParentLineItem = await tx.projectLineItem.findFirst({
      where: { prepId: prep.id, isPrepChild: false, organizationId },
    });

    // Check in the container asset
    if (prep.containerAssetId) {
      const containerCondition = conditionMap.get("container") || "GOOD";
      const containerStatus = containerCondition === "DAMAGED" ? "IN_MAINTENANCE" as const
        : containerCondition === "MISSING" ? "LOST" as const
        : "AVAILABLE" as const;

      await tx.asset.update({
        where: { id: prep.containerAssetId },
        data: { status: containerStatus, locationId: defaultLocationId },
      });
    }

    // Check in all items
    for (const item of prep.items) {
      const itemCondition = conditionMap.get(item.id) || "GOOD";

      if (item.kitId && item.kit) {
        // Kit — return the kit and all its contents
        const kitLineItem = item.lineItemId
          ? await tx.projectLineItem.findUnique({ where: { id: item.lineItemId } })
          : null;

        if (kitLineItem) {
          await tx.projectLineItem.update({
            where: { id: kitLineItem.id },
            data: { status: "RETURNED", returnedQuantity: 1, returnedAt: new Date(), returnedById: userId, returnCondition: itemCondition },
          });
          await tx.projectLineItem.updateMany({
            where: { parentLineItemId: kitLineItem.id, organizationId },
            data: { status: "RETURNED", returnedQuantity: 1, returnedAt: new Date(), returnedById: userId, returnCondition: itemCondition },
          });
        }

        const newKitStatus = itemCondition === "DAMAGED" ? "IN_MAINTENANCE" as const
          : itemCondition === "MISSING" ? "INCOMPLETE" as const
          : "AVAILABLE" as const;
        await tx.kit.update({
          where: { id: item.kitId },
          data: { status: newKitStatus, locationId: defaultLocationId },
        });

        const kitItems = await tx.kitSerializedItem.findMany({ where: { kitId: item.kitId } });
        const assetStatus = itemCondition === "DAMAGED" ? "IN_MAINTENANCE" as const
          : itemCondition === "MISSING" ? "LOST" as const
          : "AVAILABLE" as const;
        for (const ki of kitItems) {
          await tx.asset.update({
            where: { id: ki.assetId },
            data: { status: assetStatus, locationId: defaultLocationId },
          });
        }
      } else if (item.assetId && item.asset) {
        const assetStatus = itemCondition === "DAMAGED" ? "IN_MAINTENANCE" as const
          : itemCondition === "MISSING" ? "LOST" as const
          : "AVAILABLE" as const;

        await tx.asset.update({
          where: { id: item.assetId },
          data: { status: assetStatus, locationId: defaultLocationId },
        });

        if (item.lineItemId) {
          await tx.projectLineItem.update({
            where: { id: item.lineItemId },
            data: {
              status: "RETURNED",
              returnedQuantity: 1,
              returnedAt: new Date(),
              returnedById: userId,
              returnCondition: itemCondition,
              assetId: null,
            },
          });
        }
      } else if (item.bulkAssetId) {
        // Find the prep child line item for this bulk asset
        if (prepParentLineItem) {
          const childLineItem = await tx.projectLineItem.findFirst({
            where: {
              parentLineItemId: prepParentLineItem.id,
              bulkAssetId: item.bulkAssetId,
              isPrepChild: true,
            },
          });
          if (childLineItem) {
            await tx.projectLineItem.update({
              where: { id: childLineItem.id },
              data: {
                status: "RETURNED",
                returnedQuantity: childLineItem.quantity,
                returnedAt: new Date(),
                returnedById: userId,
                returnCondition: conditionMap.get(item.id) || "GOOD",
              },
            });
          }
        }
      }
    }

    // Update the prep parent line item
    if (prepParentLineItem) {
      await tx.projectLineItem.update({
        where: { id: prepParentLineItem.id },
        data: {
          status: "RETURNED",
          returnedQuantity: 1,
          returnedAt: new Date(),
          returnedById: userId,
        },
      });
    }

    // Create scan log
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: prep.containerAssetId,
        projectId: prep.projectId,
        action: "CHECK_IN",
        scannedById: userId,
        notes: `Prep "${prep.name}" returned with ${prep.items.length} items`,
      },
    });

    // Update prep status
    const updated = await tx.prep.update({
      where: { id: prepId },
      data: { status: "RETURNED", returnedAt: new Date() },
    });

    return updated;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_IN",
    entityType: "prep",
    entityId: prepId,
    entityName: result.name,
    summary: `Returned prep "${result.name}"`,
    projectId: result.projectId,
  });

  return serialize(result);
}

export async function unpackPrep(id: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "prep");

  const prep = await prisma.prep.findFirst({ where: { id, organizationId } });
  if (!prep) throw new Error("Prep not found");
  if (prep.status !== "RETURNED") throw new Error("Prep must be in RETURNED state to unpack");

  await prisma.$transaction(async (tx) => {
    // Find the prep parent line item
    const parentLineItem = await tx.projectLineItem.findFirst({
      where: { prepId: id, isPrepChild: false, organizationId },
    });

    if (parentLineItem) {
      // Get all children before dissolving
      const children = await tx.projectLineItem.findMany({
        where: { parentLineItemId: parentLineItem.id, organizationId },
      });

      // Merge split bulk quantities back
      for (const child of children) {
        if (child.bulkAssetId && child.isPrepChild) {
          // Find the standalone remainder line item for this bulk asset (not a prep/kit child)
          const remainderLineItem = await tx.projectLineItem.findFirst({
            where: {
              projectId: prep.projectId,
              organizationId,
              bulkAssetId: child.bulkAssetId,
              isPrepChild: false,
              isKitChild: false,
              id: { not: parentLineItem.id },
            },
          });

          if (remainderLineItem && remainderLineItem.status !== "RETURNED") {
            // Merge quantity back into the remainder (only if it hasn't been returned separately)
            await tx.projectLineItem.update({
              where: { id: remainderLineItem.id },
              data: { quantity: remainderLineItem.quantity + child.quantity },
            });
            // Delete the split child
            await tx.projectLineItem.delete({ where: { id: child.id } });
          } else {
            // No remainder found — the full quantity was taken. Un-parent the child.
            await tx.projectLineItem.update({
              where: { id: child.id },
              data: { isPrepChild: false, parentLineItemId: null },
            });
          }
        } else {
          // Non-bulk children: just un-parent them
          await tx.projectLineItem.update({
            where: { id: child.id },
            data: { isPrepChild: false, parentLineItemId: null },
          });
        }
      }

      // Delete the prep parent line item
      await tx.projectLineItem.delete({ where: { id: parentLineItem.id } });
    }

    // Mark prep as UNPACKED
    await tx.prep.update({
      where: { id },
      data: { status: "UNPACKED", unpackedAt: new Date() },
    });
  });

  const updated = await prisma.prep.findFirst({
    where: { id, organizationId },
    include: PREP_INCLUDE,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "STATUS_CHANGE",
    entityType: "prep",
    entityId: id,
    entityName: prep.name,
    summary: `Unpacked prep "${prep.name}"`,
    projectId: prep.projectId,
  });

  return serialize(updated);
}

// ---------------------------------------------------------------------------
// 5. Lookup — used by warehouse scanner
// ---------------------------------------------------------------------------

export async function lookupPrepByContainerScan(assetTag: string, projectId: string) {
  const { organizationId } = await getOrgContext();

  // Find an asset with this tag that is a container for an active prep on this project
  const asset = await prisma.asset.findUnique({
    where: { organizationId_assetTag: { organizationId, assetTag } },
    select: { id: true },
  });

  if (!asset) return null;

  const prep = await prisma.prep.findFirst({
    where: {
      containerAssetId: asset.id,
      projectId,
      organizationId,
      status: { notIn: ["UNPACKED", "CANCELLED"] },
    },
    include: PREP_INCLUDE,
  });

  return prep ? serialize(prep) : null;
}

// Also look up prep containers across all projects (for global scan)
export async function lookupPrepByContainerAssetId(assetId: string) {
  const { organizationId } = await getOrgContext();

  const prep = await prisma.prep.findFirst({
    where: {
      containerAssetId: assetId,
      organizationId,
      status: { notIn: ["UNPACKED", "CANCELLED"] },
    },
    include: PREP_INCLUDE,
  });

  return prep ? serialize(prep) : null;
}
