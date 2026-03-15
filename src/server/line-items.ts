"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  lineItemSchema,
  type LineItemFormValues,
} from "@/lib/validations/line-item";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";

export async function addLineItem(projectId: string, data: LineItemFormValues, allowOverbook = false) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = lineItemSchema.parse(data);

  // Server-side availability enforcement for equipment
  if (parsed.type === "EQUIPMENT" && parsed.modelId && !allowOverbook) {
    const project = await prisma.project.findUnique({
      where: { id: projectId, organizationId },
      select: { rentalStartDate: true, rentalEndDate: true },
    });

    if (project?.rentalStartDate && project?.rentalEndDate) {
      if (parsed.assetId) {
        // Check if asset is in a kit
        const assetCheck = await prisma.asset.findUnique({ where: { id: parsed.assetId }, include: { kit: { select: { assetTag: true } } } });
        if (assetCheck?.kitId) {
          throw new Error(`Asset is part of Kit ${assetCheck.kit?.assetTag}. Remove it from the Kit first, or add the Kit to the project instead.`);
        }

        // Specific asset — check if it's booked in an overlapping project
        const conflict = await prisma.projectLineItem.findFirst({
          where: {
            organizationId,
            assetId: parsed.assetId,
            status: { not: "CANCELLED" },
            project: {
              status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
              rentalStartDate: { lte: project.rentalEndDate },
              rentalEndDate: { gte: project.rentalStartDate },
              id: { not: projectId },
            },
          },
          include: { project: { select: { projectNumber: true, name: true } } },
        });
        if (conflict) {
          throw new Error(`Asset is already booked on ${conflict.project.projectNumber} - ${conflict.project.name}`);
        }

        // Also check asset status
        const asset = await prisma.asset.findUnique({ where: { id: parsed.assetId } });
        if (asset && asset.status !== "AVAILABLE") {
          throw new Error(`Asset is not available (status: ${asset.status.replace("_", " ")})`);
        }
      } else {
        // Model-level — check quantity against available stock
        const model = await prisma.model.findUnique({
          where: { id: parsed.modelId },
          include: {
            assets: { where: { isActive: true } },
            bulkAssets: { where: { isActive: true } },
          },
        });

        if (model) {
          const overlapping = await prisma.projectLineItem.findMany({
            where: {
              organizationId,
              modelId: parsed.modelId,
              status: { not: "CANCELLED" },
              project: {
                status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
                rentalStartDate: { lte: project.rentalEndDate },
                rentalEndDate: { gte: project.rentalStartDate },
              },
            },
          });

          const booked = overlapping.reduce((sum, li) => sum + li.quantity, 0);
          const totalStock = model.assetType === "SERIALIZED"
            ? model.assets.length
            : model.bulkAssets.reduce((sum, ba) => sum + ba.totalQuantity, 0);
          const available = Math.max(0, totalStock - booked);

          if (parsed.quantity > available) {
            throw new Error(`Only ${available} available (${booked} already booked out of ${totalStock} total)`);
          }
        }
      }
    }
  }

  // If adding by model (no specific asset), merge into existing line item for same model on this project
  if (parsed.type === "EQUIPMENT" && parsed.modelId && !parsed.assetId) {
    const existing = await prisma.projectLineItem.findFirst({
      where: {
        projectId,
        organizationId,
        modelId: parsed.modelId,
        assetId: null,
        isKitChild: false,
        isPrepChild: false,
        status: { not: "CANCELLED" },
      },
    });

    if (existing) {
      const oldQuantity = existing.quantity;
      const newQuantity = existing.quantity + parsed.quantity;
      const newLineTotal = calculateLineTotal(
        parsed.unitPrice ?? (existing.unitPrice ? Number(existing.unitPrice) : undefined),
        newQuantity,
        parsed.duration || existing.duration,
        parsed.discount ?? (existing.discount ? Number(existing.discount) : undefined),
      );

      const result = await prisma.projectLineItem.update({
        where: { id: existing.id },
        data: {
          quantity: newQuantity,
          unitPrice: parsed.unitPrice ?? existing.unitPrice,
          pricingType: parsed.pricingType || existing.pricingType,
          duration: parsed.duration || existing.duration,
          discount: parsed.discount ?? existing.discount,
          lineTotal: newLineTotal,
          groupName: parsed.groupName || existing.groupName,
          notes: parsed.notes
            ? existing.notes
              ? `${existing.notes}; ${parsed.notes}`
              : parsed.notes
            : existing.notes,
        },
        include: { model: true, asset: true, bulkAsset: true },
      });

      await recalculateProjectTotals(projectId);

      await logActivity({
        organizationId,
        userId,
        userName,
        action: "UPDATE",
        entityType: "lineItem",
        entityId: result.id,
        entityName: result.description || `Line item`,
        summary: `Merged line item into existing on project (qty ${oldQuantity} -> ${newQuantity})`,
        projectId,
      });

      return serialize(result);
    }
  }

  const lineTotal = calculateLineTotal(
    parsed.unitPrice,
    parsed.quantity,
    parsed.duration,
    parsed.discount
  );

  const maxSort = await prisma.projectLineItem.aggregate({
    where: { projectId, organizationId },
    _max: { sortOrder: true },
  });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  const result = await prisma.projectLineItem.create({
    data: {
      organizationId,
      projectId,
      type: parsed.type,
      modelId: parsed.modelId || null,
      assetId: parsed.assetId || null,
      bulkAssetId: parsed.bulkAssetId || null,
      description: parsed.description || null,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice ?? null,
      pricingType: parsed.pricingType,
      duration: parsed.duration,
      discount: parsed.discount ?? null,
      lineTotal,
      sortOrder: nextSort,
      groupName: parsed.groupName || null,
      notes: parsed.notes || null,
      isOptional: parsed.isOptional,
      isSubhire: parsed.isSubhire,
      showSubhireOnDocs: parsed.showSubhireOnDocs,
      supplierId: parsed.supplierId || null,
      subhireOrderNumber: parsed.subhireOrderNumber || null,
    },
    include: {
      model: true,
      asset: true,
      bulkAsset: true,
      supplier: true,
    },
  });

  await recalculateProjectTotals(projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "lineItem",
    entityId: result.id,
    entityName: result.description || `Line item`,
    summary: `Added line item to project`,
    projectId,
  });

  return serialize(result);
}

export async function updateLineItem(id: string, data: LineItemFormValues, allowOverbook = false) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = lineItemSchema.parse(data);

  const lineTotal = calculateLineTotal(
    parsed.unitPrice,
    parsed.quantity,
    parsed.duration,
    parsed.discount
  );

  const result = await prisma.projectLineItem.update({
    where: { id, organizationId },
    data: {
      type: parsed.type,
      modelId: parsed.modelId || null,
      assetId: parsed.assetId || null,
      bulkAssetId: parsed.bulkAssetId || null,
      description: parsed.description || null,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice ?? null,
      pricingType: parsed.pricingType,
      duration: parsed.duration,
      discount: parsed.discount ?? null,
      lineTotal,
      groupName: parsed.groupName || null,
      notes: parsed.notes || null,
      isOptional: parsed.isOptional,
      isSubhire: parsed.isSubhire,
      showSubhireOnDocs: parsed.showSubhireOnDocs,
      supplierId: parsed.supplierId || null,
      subhireOrderNumber: parsed.subhireOrderNumber || null,
    },
    include: {
      model: true,
      asset: true,
      bulkAsset: true,
      supplier: true,
    },
  });

  await recalculateProjectTotals(result.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "lineItem",
    entityId: result.id,
    entityName: result.description || `Line item`,
    summary: `Updated line item on project`,
    projectId: result.projectId,
  });

  return serialize(result);
}

export async function addKitLineItem(
  projectId: string,
  kitId: string,
  pricingMode: "KIT_PRICE" | "ITEMIZED" = "KIT_PRICE",
  unitPrice?: number,
  groupName?: string,
) {
  const { organizationId } = await requirePermission("project", "manage_line_items");

  const kit = await prisma.kit.findUnique({
    where: { id: kitId, organizationId },
    include: {
      serializedItems: { include: { asset: { include: { model: true } } }, orderBy: { sortOrder: "asc" } },
      bulkItems: { include: { bulkAsset: { include: { model: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!kit) throw new Error("Kit not found");
  if (kit.status !== "AVAILABLE") throw new Error(`Kit is not available (status: ${kit.status})`);

  // Check not already on an overlapping project
  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    select: { rentalStartDate: true, rentalEndDate: true },
  });
  if (project?.rentalStartDate && project?.rentalEndDate) {
    const conflict = await prisma.projectLineItem.findFirst({
      where: {
        organizationId, kitId, isKitChild: false, status: { not: "CANCELLED" },
        project: { status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] }, rentalStartDate: { lte: project.rentalEndDate }, rentalEndDate: { gte: project.rentalStartDate }, id: { not: projectId } },
      },
      include: { project: { select: { projectNumber: true, name: true } } },
    });
    if (conflict) throw new Error(`Kit is already on ${conflict.project.projectNumber} - ${conflict.project.name}`);
  }

  const maxSort = await prisma.projectLineItem.aggregate({ where: { projectId, organizationId }, _max: { sortOrder: true } });
  let nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  const result = await prisma.$transaction(async (tx) => {
    // Create parent kit line item
    const parentItem = await tx.projectLineItem.create({
      data: {
        organizationId, projectId, type: "EQUIPMENT", kitId,
        description: `${kit.assetTag} - ${kit.name}`,
        quantity: 1, unitPrice: unitPrice ?? null, pricingType: "PER_DAY", duration: 1,
        lineTotal: unitPrice ?? null, sortOrder: nextSort++, pricingMode,
        groupName: groupName || null,
      },
    });

    // Create child line items for serialized items
    for (const si of kit.serializedItems) {
      const childPrice = pricingMode === "ITEMIZED" ? (si.asset.model.defaultRentalPrice ? Number(si.asset.model.defaultRentalPrice) : null) : null;
      await tx.projectLineItem.create({
        data: {
          organizationId, projectId, type: "EQUIPMENT",
          modelId: si.asset.modelId, assetId: si.assetId,
          description: si.asset.model.name,
          quantity: 1, unitPrice: childPrice, pricingType: "PER_DAY", duration: 1,
          lineTotal: childPrice, sortOrder: nextSort++,
          isKitChild: true, parentLineItemId: parentItem.id,
        },
      });
    }

    // Create child line items for bulk items
    for (const bi of kit.bulkItems) {
      const childPrice = pricingMode === "ITEMIZED" ? (bi.bulkAsset.model.defaultRentalPrice ? Number(bi.bulkAsset.model.defaultRentalPrice) * bi.quantity : null) : null;
      await tx.projectLineItem.create({
        data: {
          organizationId, projectId, type: "EQUIPMENT",
          modelId: bi.bulkAsset.modelId, bulkAssetId: bi.bulkAssetId,
          description: `${bi.quantity}x ${bi.bulkAsset.model.name}`,
          quantity: bi.quantity, unitPrice: childPrice ? childPrice / bi.quantity : null,
          pricingType: "PER_DAY", duration: 1, lineTotal: childPrice, sortOrder: nextSort++,
          isKitChild: true, parentLineItemId: parentItem.id,
        },
      });
    }

    return { parentItem, nextSort };
  });

  await recalculateProjectTotals(projectId);
  return serialize(result.parentItem);
}

export async function removeLineItem(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const item = await prisma.projectLineItem.findFirst({
    where: { id, organizationId },
  });
  if (!item) throw new Error("Line item not found");

  // Block removal of kit/prep child items
  if (item.isKitChild) {
    throw new Error("This item is part of a Kit. Remove the Kit instead.");
  }
  if (item.isPrepChild) {
    throw new Error("This item is part of a Prep. Unpack the Prep instead.");
  }

  // If this is a kit parent, cascade delete children
  const hasKitChildren = item.kitId && !item.isKitChild;
  if (hasKitChildren) {
    await prisma.projectLineItem.deleteMany({
      where: { parentLineItemId: item.id, organizationId },
    });
  }

  // Block deletion of prep parent line items — use unpackPrep instead
  const isPrepParent = item.prepId && !item.isPrepChild;
  if (isPrepParent) {
    throw new Error("This item is a Prep group. Use Unpack to dissolve it.");
  }

  await prisma.projectLineItem.delete({ where: { id } });
  await recalculateProjectTotals(item.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "lineItem",
    entityId: id,
    entityName: item.description || `Line item`,
    summary: `Removed line item from project`,
    projectId: item.projectId,
  });

  return serialize({ success: true });
}

export async function reorderLineItems(
  projectId: string,
  itemIds: string[],
  groupUpdates?: { id: string; groupName: string | null }[],
) {
  const { organizationId } = await requirePermission("project", "manage_line_items");

  const updates = itemIds.map((id, index) =>
    prisma.projectLineItem.update({
      where: { id, organizationId },
      data: { sortOrder: index },
    })
  );

  if (groupUpdates?.length) {
    for (const { id, groupName } of groupUpdates) {
      updates.push(
        prisma.projectLineItem.update({
          where: { id, organizationId },
          data: { groupName: groupName || null },
        })
      );
    }
  }

  await prisma.$transaction(updates);

  return serialize({ success: true });
}

export async function checkAvailability(
  modelId: string,
  rentalStartDate: Date | string,
  rentalEndDate: Date | string,
  excludeProjectId?: string
) {
  const { organizationId } = await getOrgContext();

  // Ensure dates are proper Date objects (they may arrive as strings from server action serialization)
  const startDate = new Date(rentalStartDate);
  const endDate = new Date(rentalEndDate);

  // Get the model with asset type info
  const model = await prisma.model.findUnique({
    where: { id: modelId, organizationId },
    include: {
      assets: { where: { isActive: true } },
      bulkAssets: { where: { isActive: true } },
    },
  });

  if (!model) {
    return serialize({ totalStock: 0, effectiveStock: 0, booked: 0, available: 0, bookedOnThisProject: 0, unavailable: 0, inMaintenance: 0, lost: 0, conflicts: [] as string[] });
  }

  // Find overlapping projects (where the project rental period overlaps with the given dates)
  // Include both regular items AND kit children — they all consume stock
  const overlappingLineItems = await prisma.projectLineItem.findMany({
    where: {
      organizationId,
      modelId,
      status: { not: "CANCELLED" },
      project: {
        isTemplate: false,
        status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
        rentalStartDate: { lte: endDate },
        rentalEndDate: { gte: startDate },
      },
    },
    include: {
      project: { select: { id: true, name: true, projectNumber: true } },
    },
  });

  const bookedOnThisProject = excludeProjectId
    ? overlappingLineItems
        .filter((li) => li.project.id === excludeProjectId)
        .reduce((sum, li) => sum + li.quantity, 0)
    : 0;

  const conflicts = [
    ...new Map(
      overlappingLineItems
        .filter((li) => !excludeProjectId || li.project.id !== excludeProjectId)
        .map((li) => [
          li.project.id,
          `${li.project.projectNumber} - ${li.project.name}`,
        ])
    ).values(),
  ];

  const booked = overlappingLineItems.reduce(
    (sum, li) => sum + li.quantity,
    0
  );

  if (model.assetType === "SERIALIZED") {
    const totalStock = model.assets.length;
    const inMaintenance = model.assets.filter((a) => a.status === "IN_MAINTENANCE").length;
    const lost = model.assets.filter((a) => a.status === "LOST").length;
    const retired = model.assets.filter((a) => a.status === "RETIRED").length;
    const unavailable = inMaintenance + lost + retired;
    const effectiveStock = totalStock - unavailable;
    const available = Math.max(0, effectiveStock - booked);

    return serialize({
      totalStock, effectiveStock, booked, available, bookedOnThisProject,
      unavailable, inMaintenance, lost, conflicts,
    });
  } else {
    // BULK: sum up total quantity across all bulk assets
    const totalStock = model.bulkAssets.reduce(
      (sum, ba) => sum + ba.totalQuantity,
      0
    );
    const available = Math.max(0, totalStock - booked);

    return serialize({
      totalStock, effectiveStock: totalStock, booked, available, bookedOnThisProject,
      unavailable: 0, inMaintenance: 0, lost: 0, conflicts,
    });
  }
}

export async function lookupAssetByTag(
  assetTag: string,
  rentalStartDate?: Date | string,
  rentalEndDate?: Date | string,
  excludeProjectId?: string
) {
  const { organizationId } = await getOrgContext();

  const asset = await prisma.asset.findUnique({
    where: { organizationId_assetTag: { organizationId, assetTag } },
    include: { model: { include: { category: true } }, location: true },
  });

  if (!asset) {
    return serialize({ found: false as const, asset: null, available: false, conflictsWith: null });
  }

  // Check if this specific asset is booked in any overlapping project
  let available = true;
  let conflictsWith: string | null = null;

  if (rentalStartDate && rentalEndDate) {
    const startDate = new Date(rentalStartDate);
    const endDate = new Date(rentalEndDate);

    const overlapping = await prisma.projectLineItem.findFirst({
      where: {
        organizationId,
        assetId: asset.id,
        status: { not: "CANCELLED" },
        project: {
          status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
          rentalStartDate: { lte: endDate },
          rentalEndDate: { gte: startDate },
          ...(excludeProjectId ? { id: { not: excludeProjectId } } : {}),
        },
      },
      include: { project: { select: { projectNumber: true, name: true } } },
    });

    if (overlapping) {
      available = false;
      conflictsWith = `${overlapping.project.projectNumber} - ${overlapping.project.name}`;
    }
  }

  // Also flag if asset is not in AVAILABLE status
  if (asset.status !== "AVAILABLE") {
    available = false;
    if (!conflictsWith) {
      conflictsWith = `Asset status: ${asset.status.replace("_", " ")}`;
    }
  }

  return serialize({ found: true as const, asset, available, conflictsWith });
}

export async function checkKitAvailability(
  kitId: string,
  rentalStartDate: Date | string,
  rentalEndDate: Date | string,
  excludeProjectId?: string
) {
  const { organizationId } = await getOrgContext();

  const startDate = new Date(rentalStartDate);
  const endDate = new Date(rentalEndDate);

  const kit = await prisma.kit.findUnique({
    where: { id: kitId, organizationId },
    select: { status: true },
  });

  if (!kit) {
    return serialize({ available: false, conflictsWith: "Kit not found" });
  }

  if (kit.status !== "AVAILABLE") {
    return serialize({ available: false, conflictsWith: `Kit status: ${kit.status.replace("_", " ")}` });
  }

  const conflict = await prisma.projectLineItem.findFirst({
    where: {
      organizationId,
      kitId,
      isKitChild: false,
      status: { not: "CANCELLED" },
      project: {
        isTemplate: false,
        status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
        rentalStartDate: { lte: endDate },
        rentalEndDate: { gte: startDate },
        ...(excludeProjectId ? { id: { not: excludeProjectId } } : {}),
      },
    },
    include: { project: { select: { projectNumber: true, name: true } } },
  });

  if (conflict) {
    return serialize({
      available: false,
      conflictsWith: `${conflict.project.projectNumber} - ${conflict.project.name}`,
    });
  }

  return serialize({ available: true, conflictsWith: null });
}

// --- Internal helpers ---

/** Round to 2 decimal places to avoid floating-point drift in financial calculations */
function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

function calculateLineTotal(
  unitPrice: number | undefined,
  quantity: number,
  duration: number,
  discount: number | undefined
): number | null {
  if (unitPrice == null) return null;
  const gross = roundCurrency(unitPrice * quantity * duration);
  const disc = discount ?? 0;
  return Math.max(0, roundCurrency(gross - disc));
}

export async function recalculateProjectTotals(projectId: string) {
  const lineItems = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      isOptional: false,
      status: { not: "CANCELLED" },
    },
  });

  const subtotal = roundCurrency(
    lineItems.reduce((sum, li) => {
      const lt =
        li.lineTotal != null
          ? typeof li.lineTotal === "number"
            ? li.lineTotal
            : Number(li.lineTotal)
          : 0;
      return sum + lt;
    }, 0)
  );

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { discountPercent: true },
  });

  const discountPercent =
    project?.discountPercent != null ? Number(project.discountPercent) : 0;
  const discountAmount = roundCurrency(subtotal * (discountPercent / 100));
  const taxableAmount = roundCurrency(subtotal - discountAmount);
  const taxAmount = roundCurrency(taxableAmount * 0.1); // 10% GST
  const total = roundCurrency(taxableAmount + taxAmount);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      subtotal,
      discountAmount,
      taxAmount,
      total,
    },
  });
}
