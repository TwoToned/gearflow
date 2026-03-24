"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { computeOverbookedStatus } from "@/lib/availability";
import type { Prisma } from "@/generated/prisma/client";
import { logActivity } from "@/lib/activity-log";

// ---------------------------------------------------------------------------
// 1. getProjectForWarehouse
// ---------------------------------------------------------------------------

export async function getProjectForWarehouse(projectId: string) {
  const { organizationId } = await getOrgContext();

  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      client: true,
      location: true,
      lineItems: {
        where: { type: "EQUIPMENT" },
        orderBy: { sortOrder: "asc" },
        include: {
          model: { include: { _count: { select: { modelCheckItems: true } } } },
          asset: true,
          bulkAsset: true,
          kit: { include: { _count: { select: { kitCheckItems: true } } } },
          childLineItems: {
            orderBy: { sortOrder: "asc" },
            include: {
              model: { include: { _count: { select: { modelCheckItems: true } } } },
              asset: true, bulkAsset: true,
              kit: { include: { _count: { select: { kitCheckItems: true } } } },
              childLineItems: {
                orderBy: { sortOrder: "asc" },
                include: {
                  model: { include: { _count: { select: { modelCheckItems: true } } } },
                  asset: true, bulkAsset: true,
                  kit: { include: { _count: { select: { kitCheckItems: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  if (project.isTemplate) {
    throw new Error("Cannot perform warehouse operations on a template");
  }

  return serialize(project);
}

// ---------------------------------------------------------------------------
// 2. lookupAssetForScan
// ---------------------------------------------------------------------------

export async function lookupAssetForScan(
  projectId: string,
  assetTag: string,
  mode: "checkout" | "checkin" = "checkout"
) {
  const { organizationId } = await getOrgContext();

  // Look up the asset tag in all tables: serialized, bulk, kits
  const [asset, bulkAsset, kit] = await Promise.all([
    prisma.asset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
      include: { model: { include: { category: true, _count: { select: { modelCheckItems: true } } } } },
    }),
    prisma.bulkAsset.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
      include: { model: { include: { category: true, _count: { select: { modelCheckItems: true } } } } },
    }),
    prisma.kit.findUnique({
      where: { organizationId_assetTag: { organizationId, assetTag } },
    }),
  ]);

  // If it's a Kit barcode
  if (kit) {
    const kitLineItem = await prisma.projectLineItem.findFirst({
      where: { projectId, organizationId, kitId: kit.id, isKitChild: false, status: { notIn: ["CANCELLED"] } },
    });
    if (!kitLineItem) {
      return serialize({
        found: true as const, type: "kit" as const, lineItemId: null, assetId: null,
        assetName: kit.name, kitId: kit.id, kitAssetTag: kit.assetTag, reason: "not_on_project" as const,
      });
    }
    if (mode === "checkout" && kitLineItem.status === "CHECKED_OUT") {
      return serialize({ found: true as const, type: "kit" as const, lineItemId: null, assetId: null, assetName: kit.name, kitId: kit.id, kitAssetTag: kit.assetTag, reason: "already_checked_out" as const });
    }
    if (mode === "checkin" && kitLineItem.status !== "CHECKED_OUT") {
      return serialize({ found: true as const, type: "kit" as const, lineItemId: null, assetId: null, assetName: kit.name, kitId: kit.id, kitAssetTag: kit.assetTag, reason: "not_checked_out" as const });
    }
    return serialize({ found: true as const, type: "kit" as const, lineItemId: kitLineItem.id, assetId: null, assetName: kit.name, kitId: kit.id, kitAssetTag: kit.assetTag, reason: null });
  }

  // If this serialized asset is inside a Kit, prompt to scan the Kit instead
  if (asset && asset.kitId) {
    const parentKit = await prisma.kit.findUnique({ where: { id: asset.kitId }, select: { id: true, assetTag: true, name: true } });
    return serialize({
      found: true as const, type: "kit_member" as const, lineItemId: null, assetId: asset.id,
      assetName: asset.model.name, kitId: parentKit?.id || null, kitAssetTag: parentKit?.assetTag || null, reason: "asset_in_kit" as const,
    });
  }

  const found = asset || bulkAsset;
  if (!found) {
    return serialize({ found: false as const, type: null, lineItemId: null, assetId: null, assetName: null, reason: null });
  }

  const modelId = found.modelId;
  const assetName = asset
    ? [asset.model.name, asset.customName ? `(${asset.customName})` : null].filter(Boolean).join(" ")
    : bulkAsset!.model.name;

  // Block checkout of retired/in-maintenance/lost assets
  if (mode === "checkout" && asset && (asset.status === "RETIRED" || asset.status === "IN_MAINTENANCE" || asset.status === "LOST")) {
    return serialize({
      found: true as const, type: null, lineItemId: null, assetId: asset.id,
      assetName, reason: "asset_unavailable" as const,
      assetStatus: asset.status,
    });
  }

  // For serialized assets, first try to find a line item with this exact asset assigned
  let lineItem = null;
  if (asset) {
    lineItem = await prisma.projectLineItem.findFirst({
      where: {
        projectId,
        organizationId,
        assetId: asset.id,
        status: { notIn: ["CANCELLED"] },
      },
      orderBy: { sortOrder: "asc" },
    });
  }

  // If no exact asset match, find by modelId (only for checkout or bulk items — never for serialized check-in)
  if (!lineItem && !(mode === "checkin" && asset)) {
    lineItem = await prisma.projectLineItem.findFirst({
      where: {
        projectId,
        organizationId,
        modelId,
        isKitChild: false,
        status: { notIn: ["CANCELLED", ...(mode === "checkout" ? ["CHECKED_OUT" as const] : [])] },
        // For checkout, don't match a line item that already has a different asset assigned
        ...(asset ? { assetId: null } : {}),
      },
      orderBy: { sortOrder: "asc" },
    });
  }

  if (!lineItem) {
    const reason = mode === "checkin" && asset
      ? "not_checked_out" as const  // Serialized asset not assigned/checked out on this project
      : "not_on_project" as const;
    return serialize({
      found: true as const,
      type: null,
      lineItemId: null,
      assetId: asset?.id || null,
      assetName,
      reason,
      // Extra info for "not_on_project" — allows client to prompt adding asset
      modelId: modelId,
      bulkAssetId: bulkAsset?.id || null,
      isBulk: !!bulkAsset,
    });
  }

  // Determine if the line item is bulk (multi-quantity without serialized asset)
  // Split items (qty=1) go through the serialized path naturally.
  // If a serialized asset was scanned, treat it as serialized even if the line item has qty > 1
  const isBulk = asset
    ? false
    : !lineItem.assetId && lineItem.quantity > 1;

  if (isBulk) {
    if (mode === "checkout") {
      // In the split flow, all units are split off before checkout.
      // If qty > 1 still, they haven't all been prepped yet.
      if (lineItem.status === "CHECKED_OUT") {
        return serialize({ found: true as const, type: "bulk" as const, lineItemId: null, assetId: null, assetName, reason: "already_checked_out" as const });
      }
    } else {
      // checkin — need units that are checked out but not yet returned
      if (lineItem.status !== "CHECKED_OUT") {
        return serialize({ found: true as const, type: "bulk" as const, lineItemId: null, assetId: null, assetName, reason: "already_returned" as const });
      }
    }

    return serialize({ found: true as const, type: "bulk" as const, lineItemId: lineItem.id, assetId: null, assetName, reason: null });
  }

  // Serialized asset
  if (mode === "checkout") {
    if (lineItem.status === "CHECKED_OUT") {
      return serialize({ found: true as const, type: "serialized" as const, lineItemId: null, assetId: null, assetName, reason: "already_checked_out" as const });
    }
    // Check if the physical asset is already checked out on another project
    if (asset && asset.status === "CHECKED_OUT") {
      // Find which project has it
      const otherLineItem = await prisma.projectLineItem.findFirst({
        where: {
          organizationId,
          assetId: asset.id,
          status: "CHECKED_OUT",
          projectId: { not: projectId },
        },
        include: { project: { select: { name: true, projectNumber: true } } },
      });
      const otherProject = otherLineItem?.project;
      const detail = otherProject
        ? ` on ${otherProject.name}${otherProject.projectNumber ? ` (${otherProject.projectNumber})` : ""}`
        : "";
      return serialize({
        found: true as const,
        type: "serialized" as const,
        lineItemId: null,
        assetId: null,
        assetName,
        reason: "asset_checked_out_elsewhere" as const,
        detail,
      });
    }
  } else {
    if (lineItem.status !== "CHECKED_OUT") {
      return serialize({ found: true as const, type: "serialized" as const, lineItemId: null, assetId: null, assetName, reason: "not_checked_out" as const });
    }
  }

  return serialize({ found: true as const, type: "serialized" as const, lineItemId: lineItem.id, assetId: asset?.id || null, assetName, reason: null });
}

// ---------------------------------------------------------------------------
// 3. checkOutItems
// ---------------------------------------------------------------------------

export async function checkOutItems(
  projectId: string,
  items: Array<{
    lineItemId: string;
    assetId?: string;
    quantity?: number;
    notes?: string;
  }>
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const results = await prisma.$transaction(async (tx) => {
    const updated: unknown[] = [];

    // Fetch the project's location to update asset locations on checkout
    const project = await tx.project.findUnique({
      where: { id: projectId, organizationId },
      select: { locationId: true },
    });
    const projectLocationId = project?.locationId || null;

    for (const item of items) {
      // Verify line item belongs to this project and org
      const lineItem = await tx.projectLineItem.findFirst({
        where: {
          id: item.lineItemId,
          projectId,
          organizationId,
        },
      });

      if (!lineItem) {
        throw new Error(`Line item ${item.lineItemId} not found in project`);
      }

      // With the split approach, prepped items are qty=1 and behave like serialized.
      // Only unsplit multi-qty items without a serialized asset use the bulk checkout path.
      const isBulk = item.assetId
        ? false
        : !lineItem.assetId && lineItem.quantity > 1;
      const checkoutQty = item.quantity || 1;

      if (isBulk) {
        // Unsplit bulk item — shouldn't normally reach here in the split flow,
        // but handle gracefully: deploy the whole item at once.
        const updatedItem = await tx.projectLineItem.update({
          where: { id: item.lineItemId },
          data: {
            checkedOutQuantity: lineItem.quantity,
            returnedQuantity: lineItem.status === "RETURNED" ? 0 : lineItem.returnedQuantity,
            status: "CHECKED_OUT",
            checkedOutAt: new Date(),
            checkedOutBy: { connect: { id: userId } },
          },
          include: { model: true, asset: true, bulkAsset: true },
        });

        // Create scan log entry
        await tx.assetScanLog.create({
          data: {
            organizationId,
            bulkAssetId: lineItem.bulkAssetId,
            projectId,
            action: "CHECK_OUT",
            scannedById: userId,
            notes: item.notes || `Checked out ${checkoutQty} of ${lineItem.quantity}`,
          },
        });

        updated.push(updatedItem);
      } else {
        // Serialized asset checkout

        // Verify the asset isn't already checked out on another project
        const assetIdToCheck = item.assetId || lineItem.assetId;
        if (assetIdToCheck) {
          const assetRecord = await tx.asset.findUnique({
            where: { id: assetIdToCheck },
            select: { status: true, assetTag: true },
          });
          if (assetRecord && assetRecord.status === "CHECKED_OUT") {
            if (lineItem.status === "CHECKED_OUT") {
              continue;
            }
            throw new Error(`Asset ${assetRecord.assetTag} is already deployed`);
          }
          if (assetRecord && (assetRecord.status === "RETIRED" || assetRecord.status === "IN_MAINTENANCE" || assetRecord.status === "LOST")) {
            throw new Error(`Asset ${assetRecord.assetTag} is ${assetRecord.status.replace("_", " ").toLowerCase()} and cannot be deployed`);
          }
        }

        // If the line item has quantity > 1 and we're assigning a specific asset,
        // split off a new line item with qty=1 for this asset. This handles the case
        // where e.g. "4x SM57" gets individual assets assigned during checkout.
        let targetLineItemId = item.lineItemId;
        if (lineItem.quantity > 1 && item.assetId) {
          // Create a new line item with quantity=1 for this specific asset
          const splitItem = await tx.projectLineItem.create({
            data: {
              organizationId: lineItem.organizationId,
              projectId: lineItem.projectId,
              type: lineItem.type,
              modelId: lineItem.modelId,
              description: lineItem.description,
              quantity: 1,
              unitPrice: lineItem.unitPrice,
              pricingType: lineItem.pricingType,
              duration: lineItem.duration,
              discount: lineItem.discount,
              lineTotal: lineItem.unitPrice
                ? lineItem.unitPrice.toNumber() * lineItem.duration
                : null,
              sortOrder: lineItem.sortOrder,
              groupName: lineItem.groupName,
              notes: lineItem.notes,
              isOptional: lineItem.isOptional,
              isSubhire: lineItem.isSubhire,
              showSubhireOnDocs: lineItem.showSubhireOnDocs,
              supplierId: lineItem.supplierId,
              subhireOrderNumber: lineItem.subhireOrderNumber,
              supplierOrderId: lineItem.supplierOrderId,
              isKitChild: lineItem.isKitChild,
              parentLineItemId: lineItem.parentLineItemId,
              pricingMode: lineItem.pricingMode,
              // Checkout fields
              status: "CHECKED_OUT",
              checkedOutQuantity: 1,
              checkedOutAt: new Date(),
              checkedOutById: userId,
              assetId: item.assetId,
            },
            include: { model: true, asset: true, bulkAsset: true },
          });

          // Reduce original line item's quantity
          const newQty = lineItem.quantity - 1;
          await tx.projectLineItem.update({
            where: { id: item.lineItemId },
            data: {
              quantity: newQty,
              lineTotal: lineItem.unitPrice
                ? lineItem.unitPrice.toNumber() * newQty * lineItem.duration
                : null,
            },
          });

          // Mark the asset as checked out
          await tx.asset.update({
            where: { id: item.assetId },
            data: {
              status: "CHECKED_OUT",
              ...(projectLocationId && { locationId: projectLocationId }),
            },
          });

          // Create scan log entry
          await tx.assetScanLog.create({
            data: {
              organizationId,
              assetId: item.assetId,
              projectId,
              action: "CHECK_OUT",
              scannedById: userId,
              notes: item.notes || null,
            },
          });

          updated.push(splitItem);
          continue; // Skip the normal update path
        }

        // Normal serialized checkout (quantity == 1 or no assetId provided)
        const updateData: Prisma.ProjectLineItemUpdateInput = {
          status: "CHECKED_OUT",
          checkedOutQuantity: 1,
          returnedQuantity: 0,
          returnCondition: null,
          returnNotes: null,
          returnedAt: null,
          checkedOutAt: new Date(),
          checkedOutBy: { connect: { id: userId } },
        };

        if (item.assetId) {
          updateData.asset = { connect: { id: item.assetId } };
        }

        const updatedItem = await tx.projectLineItem.update({
          where: { id: targetLineItemId },
          data: updateData,
          include: { model: true, asset: true, bulkAsset: true },
        });

        // Mark the serialized asset as checked out and update location to project venue
        const assetIdToUpdate = item.assetId || lineItem.assetId;
        if (assetIdToUpdate) {
          await tx.asset.update({
            where: { id: assetIdToUpdate },
            data: {
              status: "CHECKED_OUT",
              ...(projectLocationId && { locationId: projectLocationId }),
            },
          });
        }

        // Create scan log entry
        await tx.assetScanLog.create({
          data: {
            organizationId,
            assetId: assetIdToUpdate || null,
            projectId,
            action: "CHECK_OUT",
            scannedById: userId,
            notes: item.notes || null,
          },
        });

        updated.push(updatedItem);
      }
    }

    return updated;
  });

  for (const item of items) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CHECK_OUT",
      entityType: "asset",
      entityId: item.assetId || item.lineItemId,
      entityName: `Line item ${item.lineItemId}`,
      summary: `Checked out item on project`,
      projectId,
      assetId: item.assetId,
    });
  }

  return serialize(results);
}

// ---------------------------------------------------------------------------
// 4. checkInItems
// ---------------------------------------------------------------------------

export async function checkInItems(
  projectId: string,
  items: Array<{
    lineItemId: string;
    returnCondition: "GOOD" | "DAMAGED" | "MISSING";
    quantity?: number;
    notes?: string;
  }>
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  const results = await prisma.$transaction(async (tx) => {
    const updated: unknown[] = [];

    // Find the org's default location to restore assets to on return
    const defaultLocation = await tx.location.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    const defaultLocationId = defaultLocation?.id || null;

    for (const item of items) {
      // Verify line item belongs to this project and org
      const lineItem = await tx.projectLineItem.findFirst({
        where: {
          id: item.lineItemId,
          projectId,
          organizationId,
        },
      });

      if (!lineItem) {
        throw new Error(`Line item ${item.lineItemId} not found in project`);
      }

      // With the split approach, deployed bulk items are qty=1 and behave like serialized.
      // Only unsplit bulk items (qty > 1 with bulkAssetId) use the bulk return path.
      const isBulk = !lineItem.assetId && lineItem.quantity > 1;
      const returnQty = item.quantity || 1;

      if (isBulk) {
        // Unsplit bulk item — shouldn't normally reach here in the split flow,
        // but handle gracefully
        const newReturnedQty = lineItem.returnedQuantity + returnQty;
        const fullyReturned = newReturnedQty >= lineItem.checkedOutQuantity;

        const updatedItem = await tx.projectLineItem.update({
          where: { id: item.lineItemId },
          data: {
            returnedQuantity: newReturnedQty,
            status: fullyReturned ? "RETURNED" : "CHECKED_OUT",
            returnedAt: fullyReturned ? new Date() : lineItem.returnedAt,
            ...(fullyReturned ? { returnedBy: { connect: { id: userId } } } : {}),
            returnCondition: fullyReturned ? item.returnCondition : lineItem.returnCondition,
            returnNotes: item.notes || lineItem.returnNotes,
          },
          include: { model: true, asset: true, bulkAsset: true },
        });

        // Create scan log entry
        await tx.assetScanLog.create({
          data: {
            organizationId,
            bulkAssetId: lineItem.bulkAssetId,
            projectId,
            action: "CHECK_IN",
            scannedById: userId,
            notes: item.notes || `Returned ${returnQty} of ${lineItem.checkedOutQuantity}`,
          },
        });

        updated.push(updatedItem);
      } else {
        // Serialized asset — unassign the specific asset so any asset of that model can be used next time
        const updatedItem = await tx.projectLineItem.update({
          where: { id: item.lineItemId },
          data: {
            status: "RETURNED",
            returnedQuantity: 1,
            returnedAt: new Date(),
            returnedBy: { connect: { id: userId } },
            returnCondition: item.returnCondition,
            returnNotes: item.notes || null,
            asset: lineItem.assetId ? { disconnect: true } : undefined,
          },
          include: { model: true, asset: true, bulkAsset: true },
        });

        // Update serialized asset status and restore location based on return condition
        if (lineItem.assetId) {
          let assetStatus: "AVAILABLE" | "IN_MAINTENANCE" | "LOST";

          switch (item.returnCondition) {
            case "DAMAGED":
              assetStatus = "IN_MAINTENANCE";
              break;
            case "MISSING":
              assetStatus = "LOST";
              break;
            case "GOOD":
            default:
              assetStatus = "AVAILABLE";
              break;
          }

          await tx.asset.update({
            where: { id: lineItem.assetId },
            data: {
              status: assetStatus,
              // Restore location to default, or clear it if no default exists
              locationId: defaultLocationId,
            },
          });
        }

        // Create scan log entry
        await tx.assetScanLog.create({
          data: {
            organizationId,
            assetId: lineItem.assetId || null,
            projectId,
            action: "CHECK_IN",
            scannedById: userId,
            notes: item.notes || null,
          },
        });

        updated.push(updatedItem);
      }
    }

    return updated;
  });

  for (const item of items) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "CHECK_IN",
      entityType: "asset",
      entityId: item.lineItemId,
      entityName: `Line item ${item.lineItemId}`,
      summary: `Checked in item on project (condition: ${item.returnCondition})`,
      projectId,
    });
  }

  return serialize(results);
}

// ---------------------------------------------------------------------------
// 4b. checkOutKit — check out an entire kit and all its contents
// ---------------------------------------------------------------------------

export async function checkOutKit(projectId: string, kitId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_out");

  const result = await prisma.$transaction(async (tx) => {
    // Find the kit parent line item on this project
    const kitLineItem = await tx.projectLineItem.findFirst({
      where: { projectId, organizationId, kitId, isKitChild: false },
    });
    if (!kitLineItem) throw new Error("Kit not found on this project");

    // Fetch the project's location to update kit/asset locations
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { locationId: true },
    });
    const projectLocationId = project?.locationId || null;

    // Update kit parent line item
    await tx.projectLineItem.update({
      where: { id: kitLineItem.id },
      data: { status: "CHECKED_OUT", checkedOutQuantity: 1, checkedOutAt: new Date(), checkedOutById: userId },
    });

    // Update all child line items (direct children)
    const children = await tx.projectLineItem.findMany({
      where: { parentLineItemId: kitLineItem.id, organizationId },
      select: { id: true, assetId: true, kitId: true },
    });
    if (children.length > 0) {
      await tx.projectLineItem.updateMany({
        where: { id: { in: children.map((c) => c.id) } },
        data: { status: "CHECKED_OUT", checkedOutQuantity: 1, checkedOutAt: new Date(), checkedOutById: userId },
      });
    }

    // Handle grandchildren: children of nested kits inside this kit
    const nestedKitChildren = children.filter((c) => c.kitId);
    for (const nestedChild of nestedKitChildren) {
      // Update grandchild line items
      await tx.projectLineItem.updateMany({
        where: { parentLineItemId: nestedChild.id, organizationId },
        data: { status: "CHECKED_OUT", checkedOutQuantity: 1, checkedOutAt: new Date(), checkedOutById: userId },
      });
      // Update the nested kit entity status
      await tx.kit.update({
        where: { id: nestedChild.kitId! },
        data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
      });
      // Update serialized assets inside the nested kit
      const nestedKitItems = await tx.kitSerializedItem.findMany({ where: { kitId: nestedChild.kitId! } });
      if (nestedKitItems.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: nestedKitItems.map((ki) => ki.assetId) } },
          data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
        });
      }
    }

    // Update child assets referenced by line items (for prep-kits whose contents are line item references, not KitSerializedItem)
    const childAssetIds = children.filter((c) => c.assetId).map((c) => c.assetId!);
    if (childAssetIds.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: childAssetIds } },
        data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
      });
    }
    // Also update grandchild assets
    if (nestedKitChildren.length > 0) {
      const grandchildren = await tx.projectLineItem.findMany({
        where: { parentLineItemId: { in: nestedKitChildren.map((c) => c.id) }, organizationId },
        select: { assetId: true },
      });
      const grandchildAssetIds = grandchildren.filter((gc) => gc.assetId).map((gc) => gc.assetId!);
      if (grandchildAssetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: grandchildAssetIds } },
          data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
        });
      }
    }

    // Update Kit status and location
    await tx.kit.update({
      where: { id: kitId },
      data: {
        status: "CHECKED_OUT",
        ...(projectLocationId && { locationId: projectLocationId }),
      },
    });

    // Update all serialized assets inside the kit (KitSerializedItem records — for regular kits)
    const kitItems = await tx.kitSerializedItem.findMany({ where: { kitId } });
    if (kitItems.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: kitItems.map((ki) => ki.assetId) } },
        data: { status: "CHECKED_OUT", ...(projectLocationId && { locationId: projectLocationId }) },
      });
    }

    // Create scan log for the kit
    await tx.assetScanLog.create({
      data: { organizationId, kitId, projectId, action: "CHECK_OUT", scannedById: userId, notes: "Kit deployed with all contents" },
    });

    return { success: true, kitId };
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_OUT",
    entityType: "kit",
    entityId: kitId,
    entityName: `Kit ${kitId}`,
    summary: `Checked out kit with all contents`,
    projectId,
    kitId,
  });

  return serialize(result);
}

// ---------------------------------------------------------------------------
// 4c. checkInKit — check in an entire kit and all its contents
// ---------------------------------------------------------------------------

export async function checkInKit(
  projectId: string,
  kitId: string,
  returnCondition: "GOOD" | "DAMAGED" | "MISSING" = "GOOD"
) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  const result = await prisma.$transaction(async (tx) => {
    const kitLineItem = await tx.projectLineItem.findFirst({
      where: { projectId, organizationId, kitId, isKitChild: false },
    });
    if (!kitLineItem) throw new Error("Kit not found on this project");

    // Find the org's default location to restore kit/assets to
    const defaultLocation = await tx.location.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    const defaultLocationId = defaultLocation?.id || null;

    // Update kit parent line item
    await tx.projectLineItem.update({
      where: { id: kitLineItem.id },
      data: { status: "RETURNED", returnedQuantity: 1, returnedAt: new Date(), returnedById: userId, returnCondition },
    });

    const newKitStatus = returnCondition === "DAMAGED" ? "IN_MAINTENANCE" : returnCondition === "MISSING" ? "INCOMPLETE" : "AVAILABLE";
    const assetStatus = returnCondition === "DAMAGED" ? "IN_MAINTENANCE" : returnCondition === "MISSING" ? "LOST" : "AVAILABLE";

    // Update all child line items (direct children)
    const children = await tx.projectLineItem.findMany({
      where: { parentLineItemId: kitLineItem.id, organizationId, status: "CHECKED_OUT" },
      select: { id: true, assetId: true, kitId: true },
    });
    if (children.length > 0) {
      await tx.projectLineItem.updateMany({
        where: { id: { in: children.map((c) => c.id) } },
        data: { status: "RETURNED", returnedQuantity: 1, returnedAt: new Date(), returnedById: userId, returnCondition },
      });
    }

    // Handle grandchildren: children of nested kits inside this kit
    const nestedKitChildren = children.filter((c) => c.kitId);
    for (const nestedChild of nestedKitChildren) {
      // Return grandchild line items
      await tx.projectLineItem.updateMany({
        where: { parentLineItemId: nestedChild.id, organizationId, status: "CHECKED_OUT" },
        data: { status: "RETURNED", returnedQuantity: 1, returnedAt: new Date(), returnedById: userId, returnCondition },
      });
      // Reset the nested kit entity
      await tx.kit.update({
        where: { id: nestedChild.kitId! },
        data: { status: newKitStatus, locationId: defaultLocationId },
      });
      // Reset serialized assets inside the nested kit
      const nestedKitItems = await tx.kitSerializedItem.findMany({ where: { kitId: nestedChild.kitId! } });
      if (nestedKitItems.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: nestedKitItems.map((ki) => ki.assetId) } },
          data: { status: assetStatus, locationId: defaultLocationId },
        });
      }
    }

    // Reset child assets referenced by line items (for prep-kits)
    const childAssetIds = children.filter((c) => c.assetId).map((c) => c.assetId!);
    if (childAssetIds.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: childAssetIds } },
        data: { status: assetStatus, locationId: defaultLocationId },
      });
    }
    // Also reset grandchild assets
    if (nestedKitChildren.length > 0) {
      const grandchildren = await tx.projectLineItem.findMany({
        where: { parentLineItemId: { in: nestedKitChildren.map((c) => c.id) }, organizationId },
        select: { assetId: true },
      });
      const grandchildAssetIds = grandchildren.filter((gc) => gc.assetId).map((gc) => gc.assetId!);
      if (grandchildAssetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: grandchildAssetIds } },
          data: { status: assetStatus, locationId: defaultLocationId },
        });
      }
    }

    // Update Kit status and restore location
    await tx.kit.update({
      where: { id: kitId },
      data: { status: newKitStatus, locationId: defaultLocationId },
    });

    // Update all serialized assets inside the kit (KitSerializedItem — for regular kits)
    const kitItems = await tx.kitSerializedItem.findMany({ where: { kitId } });
    if (kitItems.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: kitItems.map((ki) => ki.assetId) } },
        data: { status: assetStatus, locationId: defaultLocationId },
      });
    }

    // Create scan log
    await tx.assetScanLog.create({
      data: { organizationId, kitId, projectId, action: "CHECK_IN", scannedById: userId, notes: `Kit returned — condition: ${returnCondition}` },
    });

    return { success: true, kitId };
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_IN",
    entityType: "kit",
    entityId: kitId,
    entityName: `Kit ${kitId}`,
    summary: `Checked in kit (condition: ${returnCondition})`,
    projectId,
    kitId,
  });

  return serialize(result);
}

// ---------------------------------------------------------------------------
// 5. getScanLog
// ---------------------------------------------------------------------------

export async function getScanLog(params?: {
  projectId?: string;
  assetId?: string;
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { projectId, assetId, page = 1, pageSize = 25 } = params || {};

  const where: Prisma.AssetScanLogWhereInput = {
    organizationId,
    ...(projectId && { projectId }),
    ...(assetId && { assetId }),
  };

  const [logs, total] = await Promise.all([
    prisma.assetScanLog.findMany({
      where,
      include: {
        asset: { include: { model: true } },
        bulkAsset: true,
        project: true,
        scannedBy: true,
      },
      orderBy: { scannedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.assetScanLog.count({ where }),
  ]);

  return serialize({
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

// ---------------------------------------------------------------------------
// 6. quickAddAndCheckOut — add an asset to a project and check it out in one go
// ---------------------------------------------------------------------------

export async function quickAddAndCheckOut(
  projectId: string,
  data: {
    modelId: string;
    assetId?: string;
    bulkAssetId?: string;
    quantity?: number;
    prepContainer?: string | null;
  }
) {
  const { organizationId, userId } = await requirePermission("warehouse", "check_out");

  const result = await prisma.$transaction(async (tx) => {
    // Get next sort order
    const maxSort = await tx.projectLineItem.aggregate({
      where: { projectId, organizationId },
      _max: { sortOrder: true },
    });
    const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

    const qty = data.quantity || 1;

    // Create the line item
    const lineItem = await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId,
        type: "EQUIPMENT",
        modelId: data.modelId,
        assetId: data.assetId || null,
        bulkAssetId: data.bulkAssetId || null,
        quantity: qty,
        sortOrder: nextSort,
        // Add to project and prep (not deploy — deploy is a separate step)
        status: "CONFIRMED",
        checkedOutQuantity: 0,
        prepStatus: "PACKED",
        prepContainer: data.prepContainer || null,
      },
      include: { model: true, asset: true, bulkAsset: true },
    });

    // Create scan log
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: data.assetId || null,
        bulkAssetId: data.bulkAssetId || null,
        projectId,
        action: "CHECK_OUT",
        scannedById: userId,
        notes: "Added to project and prepped via warehouse scan",
      },
    });

    return lineItem;
  });

  return serialize(result);
}

// ---------------------------------------------------------------------------
// 6b. clearPrepContainer — remove container assignment from line items
// ---------------------------------------------------------------------------

export async function clearPrepContainer(projectId: string, containerName: string) {
  const { organizationId } = await requirePermission("warehouse", "check_out");

  await prisma.projectLineItem.updateMany({
    where: { projectId, organizationId, prepContainer: containerName },
    data: { prepContainer: null },
  });

  return serialize({ success: true });
}

// ---------------------------------------------------------------------------
// 6c. ensureContainerOnProject — add container asset as a line item if needed
// ---------------------------------------------------------------------------

export async function ensureContainerOnProject(
  projectId: string,
  assetId: string,
  modelId: string,
  containerName: string
) {
  const { organizationId, userId } = await requirePermission("warehouse", "check_out");

  // Check if container asset is already on the project
  const existing = await prisma.projectLineItem.findFirst({
    where: { projectId, organizationId, assetId, isContainerLineItem: true },
  });
  if (existing) return serialize(existing);

  // Get next sort order
  const maxSort = await prisma.projectLineItem.aggregate({
    where: { projectId, organizationId },
    _max: { sortOrder: true },
  });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  const lineItem = await prisma.projectLineItem.create({
    data: {
      organizationId,
      projectId,
      type: "EQUIPMENT",
      modelId,
      assetId,
      quantity: 1,
      sortOrder: nextSort,
      status: "CONFIRMED",
      checkedOutQuantity: 0,
      prepStatus: "PACKED",
      prepContainer: containerName,
      isContainerLineItem: true,
    },
    include: { model: true, asset: true },
  });

  return serialize(lineItem);
}

// ---------------------------------------------------------------------------
// 6d. syncContainerStatus — auto deploy/return container when contents change
// ---------------------------------------------------------------------------

export async function syncContainerStatus(projectId: string, containerName: string) {
  const { organizationId, userId } = await requirePermission("warehouse", "check_out");

  // Find the container line item
  const containerLI = await prisma.projectLineItem.findFirst({
    where: { projectId, organizationId, isContainerLineItem: true, prepContainer: containerName },
  });
  if (!containerLI) return serialize({ updated: false });

  // Get all non-container items in this container
  const contentItems = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      organizationId,
      prepContainer: containerName,
      isContainerLineItem: false,
    },
    select: { status: true },
  });

  if (contentItems.length === 0) return serialize({ updated: false });

  const allDeployed = contentItems.every((i) => i.status === "CHECKED_OUT");
  const allReturned = contentItems.every((i) => i.status === "RETURNED");

  const allDeployedFlag = allDeployed && containerLI.status !== "CHECKED_OUT";
  const allReturnedFlag = allReturned && containerLI.status !== "RETURNED";

  if (!allDeployedFlag && !allReturnedFlag) return serialize({ updated: false });

  if (allDeployedFlag) {
    await prisma.projectLineItem.update({
      where: { id: containerLI.id },
      data: {
        status: "CHECKED_OUT",
        checkedOutQuantity: 1,
        checkedOutAt: new Date(),
        checkedOutBy: { connect: { id: userId } },
      },
    });
  } else {
    await prisma.projectLineItem.update({
      where: { id: containerLI.id },
      data: {
        status: "RETURNED",
        returnedQuantity: 1,
        returnedAt: new Date(),
        returnedBy: { connect: { id: userId } },
        returnCondition: "GOOD",
      },
    });
  }

  // Update the container asset status too
  if (containerLI.assetId) {
    await prisma.asset.update({
      where: { id: containerLI.assetId },
      data: {
        status: allDeployedFlag ? "CHECKED_OUT" : "AVAILABLE",
      },
    });
  }

  return serialize({ updated: true, status: allDeployedFlag ? "CHECKED_OUT" : "RETURNED" });
}

// ---------------------------------------------------------------------------
// 7. getAvailableAssetsForModel
// ---------------------------------------------------------------------------

export async function getAvailableAssetsForModel(modelId: string) {
  const { organizationId } = await getOrgContext();

  const assets = await prisma.asset.findMany({
    where: {
      organizationId,
      modelId,
      status: "AVAILABLE",
      // Exclude assets already assigned to an active line item on any project
      // (prepped, confirmed, or checked out — not returned/cancelled)
      lineItems: {
        none: {
          status: { notIn: ["RETURNED", "CANCELLED"] },
        },
      },
    },
    orderBy: { assetTag: "asc" },
    select: {
      id: true,
      assetTag: true,
      serialNumber: true,
      customName: true,
    },
  });

  return serialize(assets);
}

// ---------------------------------------------------------------------------
// 7. getProjectPullSheet
// ---------------------------------------------------------------------------

export async function getProjectPullSheet(projectId: string) {
  const { organizationId } = await getOrgContext();

  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      location: true,
      client: true,
      lineItems: {
        where: {
          type: "EQUIPMENT",
          status: { not: "CANCELLED" },
        },
        orderBy: { sortOrder: "asc" },
        include: {
          model: { include: { category: true, _count: { select: { modelCheckItems: true } } } },
          asset: { include: { location: true } },
          bulkAsset: true,
          kit: true,
          childLineItems: {
            where: { status: { not: "CANCELLED" } },
            orderBy: { sortOrder: "asc" },
            include: {
              model: { include: { category: true, _count: { select: { modelCheckItems: true } } } },
              asset: { include: { location: true } },
              bulkAsset: true,
              kit: true,
              childLineItems: {
                where: { status: { not: "CANCELLED" } },
                orderBy: { sortOrder: "asc" },
                include: {
                  model: { include: { category: true, _count: { select: { modelCheckItems: true } } } },
                  asset: { include: { location: true } },
                  bulkAsset: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  // Compute overbooked status
  const overbookedMap = await computeOverbookedStatus(
    organizationId,
    project.lineItems,
    project.rentalStartDate,
    project.rentalEndDate,
    project.id,
  );

  const enrichedLineItems = project.lineItems
    .filter((li) => !li.isKitChild) // Kit children render under their parent
    .map((li) => {
      const info = overbookedMap.get(li.id);
      return {
        ...li,
        isOverbooked: !!info,
        overbookedInfo: info ?? null,
        childLineItems: li.childLineItems?.map((child) => {
          const childInfo = overbookedMap.get(child.id);
          return { ...child, isOverbooked: !!childInfo, overbookedInfo: childInfo ?? null };
        }),
      };
    });

  // Group line items by groupName
  const groups: Record<string, typeof enrichedLineItems> = {};
  for (const item of enrichedLineItems) {
    const key = item.groupName || "Ungrouped";
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  }

  return serialize({
    project,
    groups,
  });
}

// ---------------------------------------------------------------------------
// 8. forceReturnAsset — reset a stuck asset to AVAILABLE
// ---------------------------------------------------------------------------

export async function forceReturnAsset(assetId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, organizationId },
    select: { id: true, assetTag: true, status: true },
  });

  if (!asset) throw new Error("Asset not found");
  if (asset.status === "AVAILABLE") throw new Error("Asset is already available");

  const defaultLocation = await prisma.location.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Return all checked-out line items for this asset across all projects
    await tx.projectLineItem.updateMany({
      where: { assetId, organizationId, status: "CHECKED_OUT" },
      data: {
        status: "RETURNED",
        returnedQuantity: 1,
        returnedAt: new Date(),
        returnCondition: "GOOD",
      },
    });

    // Reset asset status and location
    await tx.asset.update({
      where: { id: assetId },
      data: {
        status: "AVAILABLE",
        locationId: defaultLocation?.id ?? null,
      },
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "FORCE_RETURN",
    entityType: "asset",
    entityId: assetId,
    entityName: asset.assetTag,
    summary: `Force returned asset ${asset.assetTag} to available`,
  });

  return serialize({ success: true });
}

// ---------------------------------------------------------------------------
// 9. forceReturnKit — reset a stuck kit + contents to AVAILABLE
// ---------------------------------------------------------------------------

export async function forceReturnKit(kitId: string) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  const kit = await prisma.kit.findFirst({
    where: { id: kitId, organizationId },
    select: { id: true, assetTag: true, name: true, status: true },
  });

  if (!kit) throw new Error("Kit not found");
  if (kit.status === "AVAILABLE") throw new Error("Kit is already available");

  const defaultLocation = await prisma.location.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const returnData = { status: "RETURNED" as const, returnedQuantity: 1, returnedAt: now, returnCondition: "GOOD" as const };
    const resetData = { status: "AVAILABLE" as const, locationId: defaultLocation?.id ?? null };

    // Find all parent line items for this kit across all projects
    const kitParentItems = await tx.projectLineItem.findMany({
      where: { kitId, organizationId, isKitChild: false },
      select: { id: true, status: true },
    });

    for (const parent of kitParentItems) {
      // Get all children (may include nested kits with their own kitId)
      const children = await tx.projectLineItem.findMany({
        where: { parentLineItemId: parent.id, organizationId },
        select: { id: true, assetId: true, kitId: true, status: true },
      });

      // Handle grandchildren first (children of nested kits)
      const nestedKitChildren = children.filter((c) => c.kitId);
      for (const child of nestedKitChildren) {
        // Return grandchildren line items
        const grandchildren = await tx.projectLineItem.findMany({
          where: { parentLineItemId: child.id, organizationId },
          select: { id: true, assetId: true },
        });
        if (grandchildren.length > 0) {
          await tx.projectLineItem.updateMany({
            where: { id: { in: grandchildren.map((gc) => gc.id) }, status: "CHECKED_OUT" },
            data: returnData,
          });
          // Reset grandchild assets
          const gcAssetIds = grandchildren.filter((gc) => gc.assetId).map((gc) => gc.assetId!);
          if (gcAssetIds.length > 0) {
            await tx.asset.updateMany({
              where: { id: { in: gcAssetIds } },
              data: resetData,
            });
          }
        }
      }

      // Reset nested child kits to AVAILABLE + their serialized assets
      const childKitIds = nestedKitChildren.map((c) => c.kitId!);
      if (childKitIds.length > 0) {
        await tx.kit.updateMany({
          where: { id: { in: childKitIds }, organizationId },
          data: resetData,
        });
        const nestedKitAssets = await tx.kitSerializedItem.findMany({
          where: { kitId: { in: childKitIds } },
          select: { assetId: true },
        });
        if (nestedKitAssets.length > 0) {
          await tx.asset.updateMany({
            where: { id: { in: nestedKitAssets.map((a) => a.assetId) } },
            data: resetData,
          });
        }
      }

      // Return all children
      const checkedOutChildren = children.filter((c) => c.status === "CHECKED_OUT");
      if (checkedOutChildren.length > 0) {
        await tx.projectLineItem.updateMany({
          where: { id: { in: checkedOutChildren.map((c) => c.id) } },
          data: returnData,
        });
      }

      // Reset child assets to AVAILABLE
      const childAssetIds = children.filter((c) => c.assetId).map((c) => c.assetId!);
      if (childAssetIds.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: childAssetIds } },
          data: resetData,
        });
      }

      // Return parent line item
      if (parent.status === "CHECKED_OUT") {
        await tx.projectLineItem.update({
          where: { id: parent.id },
          data: returnData,
        });
      }

    }

    // Reset kit status
    await tx.kit.update({
      where: { id: kitId },
      data: resetData,
    });

    // Reset all serialized assets inside this kit (KitSerializedItem records)
    const kitItems = await tx.kitSerializedItem.findMany({
      where: { kitId },
      select: { assetId: true },
    });
    if (kitItems.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: kitItems.map((ki) => ki.assetId) } },
        data: resetData,
      });
    }
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "FORCE_RETURN",
    entityType: "kit",
    entityId: kitId,
    entityName: `${kit.assetTag} - ${kit.name}`,
    summary: `Force returned kit ${kit.assetTag} and all contents to available`,
  });

  return serialize({ success: true });
}

// ---------------------------------------------------------------------------
// 10. bulkForceReturnAssets — force return multiple assets at once
// ---------------------------------------------------------------------------

export async function bulkForceReturnAssets(assetIds: string[]) {
  const { organizationId, userId, userName } = await requirePermission("warehouse", "check_in");

  if (assetIds.length === 0) throw new Error("No assets selected");

  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, organizationId, status: "CHECKED_OUT" },
    select: { id: true, assetTag: true },
  });

  if (assets.length === 0) throw new Error("No checked-out assets found in selection");

  const defaultLocation = await prisma.location.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });

  const ids = assets.map((a) => a.id);

  await prisma.$transaction(async (tx) => {
    // Return all checked-out line items for these assets
    await tx.projectLineItem.updateMany({
      where: { assetId: { in: ids }, organizationId, status: "CHECKED_OUT" },
      data: {
        status: "RETURNED",
        returnedQuantity: 1,
        returnedAt: new Date(),
        returnCondition: "GOOD",
      },
    });

    // Reset all assets
    await tx.asset.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "AVAILABLE",
        locationId: defaultLocation?.id ?? null,
      },
    });
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "FORCE_RETURN",
    entityType: "asset",
    entityId: ids[0],
    entityName: assets.map((a) => a.assetTag).join(", "),
    summary: `Bulk force returned ${assets.length} assets to available`,
  });

  return serialize({ count: assets.length });
}
