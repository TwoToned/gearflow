"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import {
  lineItemSchema,
  customLineItemSchema,
  type LineItemFormValues,
  type CustomLineItemFormValues,
} from "@/lib/validations/line-item";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { roundCurrency } from "@/lib/formatters";
import { calculateSuggestedPrice, getGroupBillingPeriod } from "./project-groups";
import { optimizePrice, computeTotalDays } from "@/lib/pricing";
import { computeStockBreakdown } from "@/lib/availability";

export async function addLineItem(projectId: string, data: LineItemFormValues, allowOverbook = false, forceSeparate = false) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = lineItemSchema.parse(data);

  // Server-side availability enforcement for equipment
  // Sub-hire items represent third-party stock and never consume our inventory.
  if (parsed.type === "EQUIPMENT" && parsed.modelId && !parsed.isSubhire && !allowOverbook) {
    const project = await prisma.project.findUnique({
      where: { id: projectId, organizationId },
      select: { rentalStartDate: true, rentalEndDate: true },
    });

    const hasDates = !!project?.rentalStartDate && !!project?.rentalEndDate;

    if (parsed.assetId) {
      // Check if asset is in a kit
      const assetCheck = await prisma.asset.findUnique({ where: { id: parsed.assetId }, include: { kit: { select: { assetTag: true } } } });
      if (assetCheck?.kitId) {
        throw new Error(`Asset is part of Kit ${assetCheck.kit?.assetTag}. Remove it from the Kit first, or add the Kit to the project instead.`);
      }

      // Specific asset — check if it's booked in an overlapping project (only when dates exist)
      if (hasDates) {
        const conflict = await prisma.projectLineItem.findFirst({
          where: {
            organizationId,
            assetId: parsed.assetId,
            status: { not: "CANCELLED" },
            project: {
              status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
              rentalStartDate: { lte: project!.rentalEndDate! },
              rentalEndDate: { gte: project!.rentalStartDate! },
              id: { not: projectId },
            },
          },
          include: { project: { select: { projectNumber: true, name: true } } },
        });
        if (conflict) {
          throw new Error(`Asset is already booked on ${conflict.project.projectNumber} - ${conflict.project.name}`);
        }
      }

      // Block truly unavailable assets (retired, lost) but allow checked-out ones
      const asset = await prisma.asset.findUnique({ where: { id: parsed.assetId } });
      if (asset && (asset.status === "RETIRED" || asset.status === "LOST")) {
        throw new Error(`Asset is ${asset.status.replace("_", " ").toLowerCase()} and cannot be added`);
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
        // When dates exist, check overlapping bookings across projects
        // When no dates, check only this project's existing bookings against stock
        // Sub-hire items don't consume our stock so they're excluded from the count.
        const overlapping = hasDates
          ? await prisma.projectLineItem.findMany({
              where: {
                organizationId,
                modelId: parsed.modelId,
                status: { not: "CANCELLED" },
                isSubhire: false,
                project: {
                  status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
                  rentalStartDate: { lte: project!.rentalEndDate! },
                  rentalEndDate: { gte: project!.rentalStartDate! },
                },
              },
            })
          : await prisma.projectLineItem.findMany({
              where: {
                organizationId,
                modelId: parsed.modelId,
                status: { not: "CANCELLED" },
                isSubhire: false,
                projectId,
              },
            });

        const booked = overlapping.reduce((sum, li) => sum + li.quantity, 0);
        // Enforce against effectiveStock — in-maintenance/lost/retired assets
        // cannot be booked even though they still exist in the model.
        const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(model);
        const available = Math.max(0, effectiveStock - booked);

        if (parsed.quantity > available) {
          const detail = unavailable > 0
            ? `${booked} booked, ${unavailable} unavailable, ${totalStock} total`
            : `${booked} already booked out of ${totalStock} total`;
          throw new Error(`Only ${available} available (${detail})`);
        }
      }
    }
  }

  // If adding by model (no specific asset), merge into existing line item within the same group/category.
  // Never merge across sub-hire boundaries (own stock vs third-party stock).
  // When forceSeparate is true, always create a new line item.
  if (parsed.type === "EQUIPMENT" && parsed.modelId && !parsed.assetId && !forceSeparate) {
    const existing = await prisma.projectLineItem.findFirst({
      where: {
        projectId,
        organizationId,
        modelId: parsed.modelId,
        assetId: null,
        groupId: parsed.groupId ?? null,
        categoryId: parsed.categoryId ?? null,
        isKitChild: false,
        isSubhire: parsed.isSubhire ?? false,
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

      return serialize({ ...result, _merged: true, _newQuantity: newQuantity });
    }
  }

  // Auto-optimize pricing when model has rates and group/project has billing period
  let optimizedUnitPrice = parsed.unitPrice;
  let optimizedPricingType = parsed.pricingType;
  let optimizedDuration = parsed.duration;
  let priceBreakdown: string | null = null;
  let priceOverridden = false;

  if (parsed.modelId && parsed.pricingType === "PER_DAY" && !parsed.unitPrice) {
    try {
      // Get billing period from group or project
      let billingTotalDays: number | null = null;

      if (parsed.groupId) {
        const bp = await getGroupBillingPeriod(parsed.groupId);
        if (bp) billingTotalDays = bp.totalDays;
      }

      if (billingTotalDays == null) {
        // Try project-level billing
        const proj = await prisma.project.findUnique({
          where: { id: projectId },
          select: { billingMonths: true, billingWeeks: true, billingDays: true },
        });
        if (proj && (proj.billingMonths != null || proj.billingWeeks != null || proj.billingDays != null)) {
          billingTotalDays = computeTotalDays(
            proj.billingMonths ?? 0,
            proj.billingWeeks ?? 0,
            proj.billingDays ?? 0
          );
        }
      }

      if (billingTotalDays != null && billingTotalDays > 0) {
        const model = await prisma.model.findUnique({
          where: { id: parsed.modelId },
          select: { dailyRate: true, weeklyRate: true, monthlyRate: true },
        });

        if (model) {
          const dailyRate = model.dailyRate != null ? Number(model.dailyRate) : null;
          const weeklyRate = model.weeklyRate != null ? Number(model.weeklyRate) : null;
          const monthlyRate = model.monthlyRate != null ? Number(model.monthlyRate) : null;

          const result = optimizePrice(dailyRate, weeklyRate, monthlyRate, billingTotalDays);
          if (result) {
            optimizedUnitPrice = result.grandTotal;
            optimizedPricingType = "OPTIMIZED";
            optimizedDuration = 1; // CRITICAL: grandTotal already includes full period
            priceBreakdown = result.breakdown;
          }
        }
      }
    } catch {
      // Optimization failed — fall through to manual pricing
    }
  }

  const lineTotal = calculateLineTotal(
    optimizedUnitPrice,
    parsed.quantity,
    optimizedDuration,
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
      categoryId: parsed.categoryId || null,
      groupId: parsed.groupId || null,
      type: parsed.type,
      modelId: parsed.modelId || null,
      assetId: parsed.assetId || null,
      bulkAssetId: parsed.bulkAssetId || null,
      description: parsed.description || null,
      quantity: parsed.quantity,
      unitPrice: optimizedUnitPrice ?? null,
      pricingType: optimizedPricingType,
      duration: optimizedDuration,
      discount: parsed.discount ?? null,
      lineTotal,
      priceBreakdown,
      priceOverridden,
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

  // Recalculate group suggested price if item was added to a group
  if (result.groupId) {
    const suggested = await calculateSuggestedPrice(result.groupId);
    await prisma.projectGroup.update({
      where: { id: result.groupId },
      data: { suggestedPrice: suggested },
    });
  }

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

  // Detect price override: if user changes unitPrice on an OPTIMIZED item
  const existing = await prisma.projectLineItem.findUnique({
    where: { id, organizationId },
    select: { unitPrice: true, pricingType: true, projectId: true, quantity: true, modelId: true },
  });

  // Server-side availability enforcement for equipment (mirrors addLineItem).
  // Only re-validate on quantity increase. Editing other fields on an
  // already-overbooked item does not re-block — the badge surfaces the
  // existing overbook and the client-side check prevents new increases.
  if (
    existing &&
    parsed.type === "EQUIPMENT" &&
    parsed.modelId &&
    !parsed.isSubhire &&
    !allowOverbook &&
    parsed.quantity > existing.quantity
  ) {
    const project = await prisma.project.findUnique({
      where: { id: existing.projectId, organizationId },
      select: { rentalStartDate: true, rentalEndDate: true },
    });
    const hasDates = !!project?.rentalStartDate && !!project?.rentalEndDate;

    const model = await prisma.model.findUnique({
      where: { id: parsed.modelId },
      include: {
        assets: { where: { isActive: true } },
        bulkAssets: { where: { isActive: true } },
      },
    });

    if (model) {
      const overlapping = hasDates
        ? await prisma.projectLineItem.findMany({
            where: {
              organizationId,
              modelId: parsed.modelId,
              status: { not: "CANCELLED" },
              isSubhire: false,
              id: { not: id },
              project: {
                status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
                rentalStartDate: { lte: project!.rentalEndDate! },
                rentalEndDate: { gte: project!.rentalStartDate! },
              },
            },
          })
        : await prisma.projectLineItem.findMany({
            where: {
              organizationId,
              modelId: parsed.modelId,
              status: { not: "CANCELLED" },
              isSubhire: false,
              id: { not: id },
              projectId: existing.projectId,
            },
          });

      const booked = overlapping.reduce((sum, li) => sum + li.quantity, 0);
      // Enforce against effectiveStock — matches checkAvailability and the badge.
      const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(model);
      const available = Math.max(0, effectiveStock - booked);

      if (parsed.quantity > available) {
        const detail = unavailable > 0
          ? `${booked} booked, ${unavailable} unavailable, ${totalStock} total`
          : `${booked} already booked out of ${totalStock} total`;
        throw new Error(`Only ${available} available (${detail})`);
      }
    }
  }

  const isPriceChanged = existing && parsed.unitPrice != null
    && existing.pricingType === "OPTIMIZED"
    && Number(existing.unitPrice) !== parsed.unitPrice;

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
      // Only update association fields when explicitly provided — the edit
      // dialog doesn't send modelId/assetId/bulkAssetId, so undefined here
      // means "keep the existing value", not "clear it".
      ...(parsed.modelId !== undefined && { modelId: parsed.modelId || null }),
      ...(parsed.assetId !== undefined && { assetId: parsed.assetId || null }),
      ...(parsed.bulkAssetId !== undefined && { bulkAssetId: parsed.bulkAssetId || null }),
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
      ...(parsed.supplierId !== undefined && { supplierId: parsed.supplierId || null }),
      subhireOrderNumber: parsed.subhireOrderNumber || null,
      // Override detection
      ...(isPriceChanged && {
        priceOverridden: true,
        priceBreakdown: null,
        overrideReason: parsed.overrideReason || null,
      }),
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
  categoryId?: string,
  groupId?: string,
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
  // Block truly unavailable kits but allow checked-out ones — date overlap check below handles real conflicts
  if (kit.status === "IN_MAINTENANCE" || kit.status === "INCOMPLETE") {
    throw new Error(`Kit is ${kit.status.replace("_", " ").toLowerCase()} and cannot be added`);
  }

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
        categoryId: categoryId || null,
        groupId: groupId || null,
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

export async function addCustomLineItem(projectId: string, data: CustomLineItemFormValues) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");
  const parsed = customLineItemSchema.parse(data);

  // Validate project belongs to this org before writing
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new Error("Project not found");

  // Resolve groupName from groupId if provided
  let groupName: string | undefined;
  if (parsed.groupId) {
    const group = await prisma.projectGroup.findFirst({
      where: { id: parsed.groupId, projectId, organizationId },
      select: { title: true },
    });
    groupName = group?.title ?? undefined;
  }

  // Compute lineTotal and sortOrder so revenue and ordering are correct
  const lineTotal = calculateLineTotal(parsed.unitPrice, parsed.quantity, parsed.duration, parsed.discount);
  const maxSort = await prisma.projectLineItem.aggregate({ where: { projectId, organizationId }, _max: { sortOrder: true } });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const result = await prisma.projectLineItem.create({
    data: {
      organizationId,
      projectId,
      type: "EQUIPMENT",
      isCustomItem: true,
      description: parsed.description,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice ?? null,
      pricingType: parsed.pricingType,
      duration: parsed.duration,
      discount: parsed.discount ?? null,
      notes: parsed.notes ?? null,
      isOptional: parsed.isOptional,
      groupId: parsed.groupId ?? null,
      groupName: groupName ?? null,
      lineTotal,
      sortOrder,
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
    entityName: parsed.description,
    summary: `Added custom item "${parsed.description}" to project`,
    projectId,
  });

  return serialize(result);
}

export async function removeLineItem(id: string) {
  const { organizationId, userId, userName } = await requirePermission("project", "manage_line_items");

  const item = await prisma.projectLineItem.findFirst({
    where: { id, organizationId },
  });
  if (!item) throw new Error("Line item not found");

  // Block removal of kit child items
  if (item.isKitChild) {
    throw new Error("This item is part of a Kit. Remove the Kit instead.");
  }

  // If this is a kit parent, cascade delete children
  const hasKitChildren = item.kitId && !item.isKitChild;
  if (hasKitChildren) {
    await prisma.projectLineItem.deleteMany({
      where: { parentLineItemId: item.id, organizationId },
    });
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
  rentalStartDate?: Date | string | null,
  rentalEndDate?: Date | string | null,
  excludeProjectId?: string
) {
  const { organizationId } = await getOrgContext();

  const hasDates = !!rentalStartDate && !!rentalEndDate;
  const startDate = hasDates ? new Date(rentalStartDate) : null;
  const endDate = hasDates ? new Date(rentalEndDate) : null;

  // Get the model with asset type info
  const model = await prisma.model.findUnique({
    where: { id: modelId, organizationId },
    include: {
      assets: { where: { isActive: true } },
      bulkAssets: { where: { isActive: true } },
    },
  });

  if (!model) {
    return serialize({ totalStock: 0, effectiveStock: 0, booked: 0, available: 0, bookedOnThisProject: 0, unavailable: 0, inMaintenance: 0, lost: 0, conflicts: [] as string[], dateless: !hasDates });
  }

  // Find overlapping projects (where the project rental period overlaps with the given dates)
  // Include both regular items AND kit children — they all consume stock
  // Sub-hire items represent third-party stock and are excluded.
  // When no dates: only count bookings on the current project (stock-only check)
  const overlappingLineItems = hasDates
    ? await prisma.projectLineItem.findMany({
        where: {
          organizationId,
          modelId,
          status: { not: "CANCELLED" },
          isSubhire: false,
          project: {
            isTemplate: false,
            status: { notIn: ["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"] },
            rentalStartDate: { lte: endDate! },
            rentalEndDate: { gte: startDate! },
          },
        },
        include: {
          project: { select: { id: true, name: true, projectNumber: true } },
        },
      })
    : excludeProjectId
      ? await prisma.projectLineItem.findMany({
          where: {
            organizationId,
            modelId,
            status: { not: "CANCELLED" },
            isSubhire: false,
            projectId: excludeProjectId,
          },
          include: {
            project: { select: { id: true, name: true, projectNumber: true } },
          },
        })
      : [];

  const bookedOnThisProject = excludeProjectId
    ? overlappingLineItems
        .filter((li) => li.project.id === excludeProjectId)
        .reduce((sum, li) => sum + li.quantity, 0)
    : 0;

  const conflicts = hasDates
    ? [
        ...new Map(
          overlappingLineItems
            .filter((li) => !excludeProjectId || li.project.id !== excludeProjectId)
            .map((li) => [
              li.project.id,
              `${li.project.projectNumber} - ${li.project.name}`,
            ])
        ).values(),
      ]
    : [];

  const booked = overlappingLineItems.reduce(
    (sum, li) => sum + li.quantity,
    0
  );

  if (model.assetType === "SERIALIZED") {
    const { totalStock, effectiveStock, unavailable } = computeStockBreakdown(model);
    const inMaintenance = model.assets.filter((a) => a.status === "IN_MAINTENANCE").length;
    const lost = model.assets.filter((a) => a.status === "LOST").length;
    const available = Math.max(0, effectiveStock - booked);

    return serialize({
      totalStock, effectiveStock, booked, available, bookedOnThisProject,
      unavailable, inMaintenance, lost, conflicts, dateless: !hasDates,
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
      unavailable: 0, inMaintenance: 0, lost: 0, conflicts, dateless: !hasDates,
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

  // Only block truly unavailable assets — checked out/reserved assets can be added to future projects
  if (asset.status === "RETIRED" || asset.status === "LOST") {
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

  // Only block truly unavailable kits — checked out kits can still be added to future projects
  if (kit.status === "IN_MAINTENANCE" || kit.status === "INCOMPLETE") {
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

/**
 * Recalculate all project financial totals from source data.
 *
 *   equipmentRevenue = SUM(group.price × group.quantity)  [groups]
 *                    + SUM(standalone.lineTotal)           [ungrouped items]
 *   serviceCostTotal = SUM(service.costTotal) WHERE status != CANCELLED
 *   labourCostTotal  = SUM(assignment.estimatedCost)
 *   subtotal         = equipmentRevenue
 *   discountAmount   = subtotal × discountPercent / 100
 *   taxableAmount    = subtotal - discountAmount
 *   taxRate          = project.taxRate ?? org.defaultTaxRate ?? 10
 *   taxAmount        = taxableAmount × taxRate / 100
 *   total            = taxableAmount + taxAmount
 *   subHireCostTotal = SUM(subHire.totalCost) WHERE status NOT IN (CANCELLED, DRAFT)
 *   margin           = total - (serviceCostTotal + labourCostTotal + subHireCostTotal)
 */
export async function recalculateProjectTotals(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      discountPercent: true,
      taxRate: true,
      organizationId: true,
    },
  });

  // 1. Equipment revenue from groups (price × quantity)
  const groups = await prisma.projectGroup.findMany({
    where: { projectId },
    select: { price: true, quantity: true },
  });

  const groupRevenue = groups.reduce((sum, g) => {
    const price = g.price != null ? Number(g.price) : 0;
    return sum + price * g.quantity;
  }, 0);

  // 2. Equipment revenue from standalone (ungrouped) line items
  const standaloneItems = await prisma.projectLineItem.findMany({
    where: {
      projectId,
      groupId: null,
      isOptional: false,
      isKitChild: false,
      status: { not: "CANCELLED" },
    },
    select: { lineTotal: true },
  });

  const standaloneRevenue = standaloneItems.reduce((sum, li) => {
    const lt = li.lineTotal != null ? Number(li.lineTotal) : 0;
    return sum + lt;
  }, 0);

  const equipmentRevenue = roundCurrency(groupRevenue + standaloneRevenue);

  // 3. Service financials
  const services = await prisma.projectService.findMany({
    where: { projectId, status: { not: "CANCELLED" } },
    select: { costTotal: true, lineTotal: true, showOnDocuments: true },
  });

  // costTotal = what it costs us (all services)
  const serviceCostTotal = roundCurrency(
    services.reduce((sum, s) => sum + (s.costTotal != null ? Number(s.costTotal) : 0), 0)
  );

  // serviceRevenue = what we charge the client (only billable services shown on documents)
  const serviceRevenue = roundCurrency(
    services
      .filter((s) => s.showOnDocuments)
      .reduce((sum, s) => sum + (s.lineTotal != null ? Number(s.lineTotal) : 0), 0)
  );

  // 4. Labour costs from crew assignments
  const assignments = await prisma.crewAssignment.findMany({
    where: { projectId },
    select: { estimatedCost: true },
  });

  const labourCostTotal = roundCurrency(
    assignments.reduce((sum, a) => sum + (a.estimatedCost != null ? Number(a.estimatedCost) : 0), 0)
  );

  // 5. Sub-hire costs (what we pay suppliers)
  const subHires = await prisma.subHire.findMany({
    where: {
      projectId,
      status: { notIn: ["CANCELLED", "DRAFT"] },
    },
    select: { totalCost: true },
  });

  const subHireCostTotal = roundCurrency(
    subHires.reduce((sum, sh) => sum + (sh.totalCost != null ? Number(sh.totalCost) : 0), 0)
  );

  // 6. Calculate totals (equipment + billable services)
  const subtotal = roundCurrency(equipmentRevenue + serviceRevenue);
  const discountPercent = project.discountPercent != null ? Number(project.discountPercent) : 0;
  const discountAmount = roundCurrency(subtotal * (discountPercent / 100));
  const taxableAmount = roundCurrency(subtotal - discountAmount);

  // Tax rate: project override → org default → 10%
  let taxRate = 10;
  if (project.taxRate != null) {
    taxRate = Number(project.taxRate);
  } else {
    const org = await prisma.organization.findUnique({
      where: { id: project.organizationId },
      select: { defaultTaxRate: true },
    });
    if (org?.defaultTaxRate != null) {
      taxRate = Number(org.defaultTaxRate);
    }
  }

  const taxAmount = roundCurrency(taxableAmount * (taxRate / 100));
  const total = roundCurrency(taxableAmount + taxAmount);
  const margin = roundCurrency(total - (serviceCostTotal + labourCostTotal + subHireCostTotal));

  await prisma.project.update({
    where: { id: projectId },
    data: {
      equipmentRevenue,
      serviceCostTotal,
      labourCostTotal,
      subHireCostTotal,
      subtotal,
      discountAmount,
      taxAmount,
      total,
      margin,
    },
  });
}
