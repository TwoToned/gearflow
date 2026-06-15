"use server";

import { prisma } from "@/lib/prisma";
import { mirrorFileUploadDelete } from "@/lib/file-upload-mirror";
import { mirrorMediaCreate, syncMediaForParent } from "@/lib/media-mirror";
import {
  syncSubHireToConvex,
  removeSubHireFromConvex,
  removeSubHireItemFromConvex,
  removeSubHireGroupFromConvex,
} from "@/lib/sub-hire-mirror";
import { upsertProjectLineItemsToConvex, removeLineItemFromConvex } from "@/lib/line-item-mirror";
import {
  attachSupplier,
  getMatchingSupplierIds,
  getSupplierById,
} from "@/lib/suppliers-read";
import { getModelById, getModelMap } from "@/lib/models-read";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getProjectById } from "@/lib/projects-read";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { roundCurrency } from "@/lib/formatters";
import { subHireSchema, subHireItemSchema, subHireGroupSchema, subHireOrderPricingSchema, subHirePlacementSchema } from "@/lib/validations/sub-hire";
import type { SubHireStatus, SubHirePricingMode, SubHirePaymentStatus, PricingType, Prisma, MediaType } from "@/generated/prisma/client";
import { deleteFromS3 } from "@/lib/storage";

// ─── Status Machine ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<SubHireStatus, SubHireStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ON_HIRE", "RETURNED", "CANCELLED"],
  ON_HIRE: ["RETURNED", "CANCELLED"],
  RETURNED: [],
  CANCELLED: [],
};

// ─── Order Number ────────────────────────────────────────────────────────────

interface OrgSettings {
  [key: string]: unknown;
  subHireOrderCounter?: number;
}

async function reserveSubHireOrderNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) throw new Error("Organization not found");

  let settings: OrgSettings = {};
  if (org.metadata) {
    try {
      settings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

  const currentCounter = settings.subHireOrderCounter || 0;
  const orderNumber = `SH-${String(currentCounter + 1).padStart(4, "0")}`;
  settings.subHireOrderCounter = currentCounter + 1;

  await tx.organization.update({
    where: { id: organizationId },
    data: { metadata: JSON.stringify(settings) },
  });

  return orderNumber;
}

// ─── Core CRUD ───────────────────────────────────────────────────────────────

export async function getSubHires(filters?: {
  status?: SubHireStatus[];
  supplierId?: string;
  projectId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { organizationId } = await requirePermission("subHire", "read");

  const where: Prisma.SubHireWhereInput = { organizationId };

  if (filters?.status?.length) {
    where.status = { in: filters.status };
  }
  if (filters?.supplierId) {
    where.supplierId = filters.supplierId;
  }
  if (filters?.projectId) {
    where.projectId = filters.projectId;
  }
  if (filters?.dateFrom || filters?.dateTo) {
    where.hireStart = {};
    if (filters.dateFrom) where.hireStart.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.hireStart.lte = new Date(filters.dateTo);
  }
  if (filters?.search) {
    const term = filters.search;
    // Supplier lives in Convex — resolve matching supplier ids and fold them in
    // as a supplierId predicate (omit on no match). Results sort by createdAt,
    // never the supplier name, so id-resolution is order-safe.
    const matchingSupplierIds = await getMatchingSupplierIds(organizationId, term);
    where.OR = [
      { orderNumber: { contains: term, mode: "insensitive" } },
      ...(matchingSupplierIds.length > 0 ? [{ supplierId: { in: matchingSupplierIds } }] : []),
      { items: { some: { description: { contains: term, mode: "insensitive" } } } },
    ];
  }

  // When fetching for a specific project, include items and groups for equipment tab preview
  const itemsInclude = filters?.projectId
    ? {
        items: {
          include: {
            targetCategory: { select: { id: true, name: true } },
            targetGroup: { select: { id: true, title: true, categoryId: true } },
          },
          orderBy: { sortOrder: "asc" as const },
        },
        groups: {
          include: {
            targetCategory: { select: { id: true, name: true } },
            targetGroup: { select: { id: true, title: true, categoryId: true } },
            items: {
              orderBy: { sortOrder: "asc" as const },
            },
          },
          orderBy: { sortOrder: "asc" as const },
        },
      }
    : {};

  const subHires = await prisma.subHire.findMany({
    where,
    include: {
      project: { select: { id: true, name: true, projectNumber: true } },
      _count: { select: { items: true } },
      ...itemsInclude,
    },
    orderBy: { createdAt: "desc" },
  });

  // Model lives in Convex — enrich items when fetched for a specific project.
  if (filters?.projectId) {
    const modelMap = await getModelMap(organizationId);
    for (const sh of subHires as typeof subHires & { items?: { modelId: string | null }[]; groups?: { items: { modelId: string | null }[] }[] }[]) {
      if ("items" in sh && sh.items) {
        (sh as any).items = sh.items.map((item) => ({
          ...item,
          model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
        }));
      }
      if ("groups" in sh && sh.groups) {
        (sh as any).groups = sh.groups.map((g) => ({
          ...g,
          items: (g as any).items.map((item: { modelId: string | null }) => ({
            ...item,
            model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
          })),
        }));
      }
    }
  }

  // Supplier lives in Convex — attach instead of a Prisma join.
  const subHiresWithSupplier = await attachSupplier(organizationId, subHires);
  return serialize(subHiresWithSupplier);
}

export async function getSubHire(id: string) {
  const { organizationId } = await requirePermission("subHire", "read");

  const subHire = await prisma.subHire.findUnique({
    where: { id, organizationId },
    include: {
      project: { select: { id: true, name: true, projectNumber: true } },
      createdBy: { select: { id: true, name: true } },
      defaultTargetCategory: { select: { id: true, name: true } },
      defaultTargetGroup: { select: { id: true, title: true, categoryId: true } },
      groups: {
        include: {
          targetCategory: { select: { id: true, name: true } },
          targetGroup: { select: { id: true, title: true, categoryId: true } },
          items: {
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      items: {
        include: {
          targetCategory: { select: { id: true, name: true } },
          targetGroup: { select: { id: true, title: true, categoryId: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      media: {
        include: { file: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!subHire) throw new Error("Sub-hire not found");
  // Model + supplier live in Convex — enrich after query.
  const [modelMap, supplier] = await Promise.all([
    getModelMap(organizationId),
    getSupplierById(subHire.supplierId),
  ]);
  const enrichedGroups = subHire.groups.map((g) => ({
    ...g,
    items: g.items.map((item) => ({
      ...item,
      model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
    })),
  }));
  const enrichedItems = subHire.items.map((item) => ({
    ...item,
    model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
  }));
  return serialize({ ...subHire, groups: enrichedGroups, items: enrichedItems, supplier });
}

export async function createSubHire(input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "create");
  const data = subHireSchema.parse(input);

  const result = await prisma.$transaction(async (tx) => {
    const orderNumber = await reserveSubHireOrderNumber(tx, organizationId);

    const subHire = await tx.subHire.create({
      data: {
        organizationId,
        supplierId: data.supplierId,
        projectId: data.projectId || null,
        createdById: userId,
        orderNumber,
        supplierReference: data.supplierReference || null,
        status: "DRAFT",
        hireStart: data.hireStart || null,
        hireEnd: data.hireEnd || null,
        showOnDocs: data.showOnDocs,
        notes: data.notes || null,
        defaultTargetCategoryId: data.defaultTargetCategoryId || null,
        defaultTargetGroupId: data.defaultTargetGroupId || null,
      },
    });

    return subHire;
  });
  await syncSubHireToConvex(result.id);

  // Supplier lives in Convex — fetch for the log label / return shape.
  const supplier = await getSupplierById(result.supplierId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: result.id,
    entityName: `${result.orderNumber} (${supplier?.name ?? ""})`,
    summary: `Created sub-hire ${result.orderNumber}`,
  });

  return serialize({ ...result, supplier });
}

export async function updateSubHire(id: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireSchema.parse(input);

  const existing = await prisma.subHire.findUnique({
    where: { id, organizationId },
    select: { orderNumber: true, status: true },
  });
  if (!existing) throw new Error("Sub-hire not found");

  const subHire = await prisma.subHire.update({
    where: { id, organizationId },
    data: {
      supplierId: data.supplierId,
      projectId: data.projectId || null,
      supplierReference: data.supplierReference !== undefined ? (data.supplierReference || null) : undefined,
      hireStart: data.hireStart || null,
      hireEnd: data.hireEnd || null,
      showOnDocs: data.showOnDocs,
      notes: data.notes || null,
      defaultTargetCategoryId: data.defaultTargetCategoryId !== undefined ? (data.defaultTargetCategoryId || null) : undefined,
      defaultTargetGroupId: data.defaultTargetGroupId !== undefined ? (data.defaultTargetGroupId || null) : undefined,
    },
  });
  await syncSubHireToConvex(id);

  // Supplier lives in Convex — fetch for the log label / return shape.
  const supplier = await getSupplierById(subHire.supplierId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${supplier?.name ?? ""})`,
    summary: `Updated sub-hire ${subHire.orderNumber}`,
  });

  return serialize({ ...subHire, supplier });
}

export async function deleteSubHire(id: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "delete");

  const subHire = await prisma.subHire.findUnique({
    where: { id, organizationId },
    include: {
      lineItems: { select: { id: true, status: true } },
      items: { select: { id: true } },
      groups: { select: { id: true } },
    },
  });
  if (!subHire) throw new Error("Sub-hire not found");
  // Supplier lives in Convex — fetch for the log label.
  const supplierName = (await getSupplierById(subHire.supplierId))?.name ?? "";

  // Reject if any linked line items are checked out
  const checkedOut = subHire.lineItems.filter((li) => li.status === "CHECKED_OUT");
  if (checkedOut.length > 0) {
    throw new Error("Cannot delete sub-hire with checked-out items");
  }

  // Delete linked line items first, then recalculate project totals
  const projectId = subHire.projectId;

  await prisma.$transaction(async (tx) => {
    // Delete linked project line items
    if (subHire.lineItems.length > 0) {
      await tx.projectLineItem.deleteMany({
        where: { subHireId: id },
      });
    }

    // Delete sub-hire (cascades to SubHireItems)
    await tx.subHire.delete({
      where: { id, organizationId },
    });
  });

  // Mirror the cascade delete to Convex (line items + sub-hire items + groups +
  // the head). sub_hire_media stays Prisma-only.
  for (const li of subHire.lineItems) await removeLineItemFromConvex(li.id);
  for (const it of subHire.items) await removeSubHireItemFromConvex(it.id);
  for (const g of subHire.groups) await removeSubHireGroupFromConvex(g.id);
  await removeSubHireFromConvex(id);

  // Recalculate project totals if linked to a project
  if (projectId) {
    const { recalculateProjectTotals } = await import("@/server/line-items");
    await recalculateProjectTotals(projectId);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${supplierName})`,
    summary: `Deleted sub-hire ${subHire.orderNumber}`,
  });
}

export async function updateSubHireStatus(id: string, newStatus: SubHireStatus) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const subHire = await prisma.subHire.findUnique({
    where: { id, organizationId },
    include: {
      items: true,
    },
  });
  if (!subHire) throw new Error("Sub-hire not found");
  // Supplier lives in Convex — fetch for the log label.
  const supplierName = (await getSupplierById(subHire.supplierId))?.name ?? "";

  // Validate transition
  const validTargets = VALID_TRANSITIONS[subHire.status];
  if (!validTargets.includes(newStatus)) {
    throw new Error(`Cannot transition from ${subHire.status} to ${newStatus}`);
  }

  // Server-side validation: must have project to confirm
  if (newStatus === "CONFIRMED" && !subHire.projectId) {
    throw new Error("Assign a project before confirming");
  }

  // When confirming, wrap status change + line item generation in single transaction
  if (newStatus === "CONFIRMED") {
    await prisma.$transaction(async (tx) => {
      await tx.subHire.update({
        where: { id, organizationId },
        data: { status: "CONFIRMED" },
      });

      await generateSubHireLineItemsTx(tx, subHire.id, organizationId);
    });

    // Recalculate project totals after transaction
    const { recalculateProjectTotals } = await import("@/server/line-items");
    await recalculateProjectTotals(subHire.projectId!);
  } else {
    await prisma.subHire.update({
      where: { id, organizationId },
      data: { status: newStatus },
    });

    // Recalculate project totals — status changes affect which sub-hires count as costs
    if (subHire.projectId) {
      const { recalculateProjectTotals } = await import("@/server/line-items");
      await recalculateProjectTotals(subHire.projectId);
    }
  }

  // Mirror the status change + any generated line items to Convex.
  await syncSubHireToConvex(id);
  await upsertProjectLineItemsToConvex(subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${supplierName})`,
    summary: `Changed sub-hire ${subHire.orderNumber} status to ${newStatus}`,
    details: { previousStatus: subHire.status, newStatus },
  });

  const updatedSubHire = await prisma.subHire.findUnique({
    where: { id, organizationId },
    include: {
      project: { select: { id: true, name: true, projectNumber: true } },
      items: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!updatedSubHire) return serialize(null);
  // Model + supplier live in Convex — enrich after query.
  const [modelMap, supplier] = await Promise.all([
    getModelMap(organizationId),
    getSupplierById(updatedSubHire.supplierId),
  ]);
  const enrichedItems = updatedSubHire.items.map((item) => ({
    ...item,
    model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
  }));
  return serialize({ ...updatedSubHire, items: enrichedItems, supplier });
}

// ─── Item CRUD ───────────────────────────────────────────────────────────────

export async function addSubHireItem(subHireId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireItemSchema.parse(input);

  const subHire = await prisma.subHire.findUnique({
    where: { id: subHireId, organizationId },
    select: { id: true, orderNumber: true, status: true, supplierId: true, projectId: true, showOnDocs: true, defaultTargetGroupId: true, defaultTargetCategoryId: true },
  });
  if (!subHire) throw new Error("Sub-hire not found");

  // Get next sort order
  const maxSort = await prisma.subHireItem.aggregate({
    where: { subHireId },
    _max: { sortOrder: true },
  });
  const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  const item = await prisma.subHireItem.create({
    data: {
      subHireId,
      groupId: data.groupId || null,
      modelId: data.modelId || null,
      description: data.description,
      quantity: data.quantity,
      unitCost: data.unitCost,
      unitCharge: data.unitCharge,
      pricingType: data.pricingType as PricingType,
      duration: data.duration,
      discount: data.discount,
      showOnQuote: data.showOnQuote ?? true,
      showOnDocs: data.showOnDocs ?? subHire.showOnDocs ?? false,
      targetCategoryId: data.targetCategoryId || null,
      targetGroupId: data.targetGroupId || null,
      sortOrder: nextSort,
    },
  });
  // Model lives in Convex — attach after create.
  const model = item.modelId ? await getModelById(item.modelId) : null;

  await recalculateSubHireTotals(subHireId);

  // Upsert supplier rate if item has a model
  if (data.modelId) {
    await upsertSupplierModelRate(organizationId, subHire.supplierId, data.modelId, data.unitCost, data.pricingType as PricingType);
  }

  // Sync line items to project (works for any status including DRAFT)
  await syncSubHireToProject(subHireId, organizationId, subHire.projectId);
  await syncSubHireToConvex(subHireId);
  await upsertProjectLineItemsToConvex(subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: subHire.orderNumber,
    summary: `Added item "${data.description}" to ${subHire.orderNumber}`,
  });

  return serialize({ ...item, model });
}

export async function updateSubHireItem(itemId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireItemSchema.parse(input);

  const existing = await prisma.subHireItem.findUnique({
    where: { id: itemId },
    include: {
      subHire: {
        select: { id: true, organizationId: true, orderNumber: true, status: true, supplierId: true, projectId: true },
      },
    },
  });
  if (!existing || existing.subHire.organizationId !== organizationId) {
    throw new Error("Sub-hire item not found");
  }

  const item = await prisma.subHireItem.update({
    where: { id: itemId },
    data: {
      groupId: data.groupId !== undefined ? (data.groupId || null) : undefined,
      modelId: data.modelId || null,
      description: data.description,
      quantity: data.quantity,
      unitCost: data.unitCost,
      unitCharge: data.unitCharge,
      pricingType: data.pricingType as PricingType,
      duration: data.duration,
      discount: data.discount,
      showOnQuote: data.showOnQuote,
      showOnDocs: data.showOnDocs,
      targetCategoryId: data.targetCategoryId !== undefined ? (data.targetCategoryId || null) : undefined,
      targetGroupId: data.targetGroupId !== undefined ? (data.targetGroupId || null) : undefined,
    },
  });
  // Model lives in Convex — attach after update.
  const model = item.modelId ? await getModelById(item.modelId) : null;

  await recalculateSubHireTotals(existing.subHire.id);

  // Upsert supplier rate if item has a model
  if (data.modelId) {
    await upsertSupplierModelRate(organizationId, existing.subHire.supplierId, data.modelId, data.unitCost, data.pricingType as PricingType);
  }

  // Sync line items to project
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);
  await syncSubHireToConvex(existing.subHire.id);
  await upsertProjectLineItemsToConvex(existing.subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: existing.subHire.id,
    entityName: existing.subHire.orderNumber,
    summary: `Updated item "${data.description}" on ${existing.subHire.orderNumber}`,
  });

  return serialize({ ...item, model });
}

export async function removeSubHireItem(itemId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const existing = await prisma.subHireItem.findUnique({
    where: { id: itemId },
    include: {
      subHire: {
        select: { id: true, organizationId: true, orderNumber: true, projectId: true },
      },
      lineItems: { select: { id: true, status: true } },
    },
  });
  if (!existing || existing.subHire.organizationId !== organizationId) {
    throw new Error("Sub-hire item not found");
  }

  // Reject if linked line items are checked out
  const checkedOut = existing.lineItems.filter((li) => li.status === "CHECKED_OUT");
  if (checkedOut.length > 0) {
    throw new Error("Cannot remove item with checked-out line items");
  }

  // Delete the item (linked line items are cleaned up by regenerate)
  await prisma.subHireItem.delete({ where: { id: itemId } });

  await recalculateSubHireTotals(existing.subHire.id);

  // Regenerate project line items (removes orphaned items, recalculates totals)
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);
  await removeSubHireItemFromConvex(itemId);
  await syncSubHireToConvex(existing.subHire.id);
  await upsertProjectLineItemsToConvex(existing.subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "subHire",
    entityId: existing.subHire.id,
    entityName: existing.subHire.orderNumber,
    summary: `Removed item from ${existing.subHire.orderNumber}`,
  });
}

export async function reorderSubHireItems(subHireId: string, itemIds: string[]) {
  const { organizationId } = await requirePermission("subHire", "update");

  const subHire = await prisma.subHire.findUnique({
    where: { id: subHireId, organizationId },
    select: { id: true },
  });
  if (!subHire) throw new Error("Sub-hire not found");

  await prisma.$transaction(
    itemIds.map((id, index) =>
      prisma.subHireItem.update({
        where: { id, subHireId: subHire.id },
        data: { sortOrder: index },
      }),
    ),
  );
  await syncSubHireToConvex(subHireId);
}

// ─── Totals ──────────────────────────────────────────────────────────────────

async function recalculateSubHireTotals(subHireId: string) {
  const subHire = await prisma.subHire.findUnique({
    where: { id: subHireId },
    select: { pricingMode: true, orderTotalCost: true, orderTotalCharge: true },
  });
  if (!subHire) return;

  // Fetch groups with their pricing overrides
  const groups = await prisma.subHireGroup.findMany({
    where: { subHireId },
    select: { id: true, quantity: true, cost: true, charge: true },
  });
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const items = await prisma.subHireItem.findMany({
    where: { subHireId },
    select: {
      groupId: true,
      quantity: true,
      unitCost: true,
      unitCharge: true,
      pricingType: true,
      duration: true,
      discount: true,
    },
  });

  let totalCost = 0;
  let totalCharge = 0;

  if (subHire.pricingMode === "ORDER_TOTAL") {
    // In ORDER_TOTAL mode, cost comes from the flat order amount
    totalCost = Number(subHire.orderTotalCost ?? 0);
    // Charge: use group charges where set, then item charges for the rest
    if (subHire.orderTotalCharge != null) {
      totalCharge = Number(subHire.orderTotalCharge);
    } else {
      const groupChargeHandled = new Set<string>();
      for (const group of groups) {
        if (group.charge != null) {
          totalCharge += Number(group.charge) * group.quantity;
          groupChargeHandled.add(group.id);
        }
      }
      for (const item of items) {
        if (item.groupId && groupChargeHandled.has(item.groupId)) continue;
        const charge = Number(item.unitCharge);
        const disc = Number(item.discount);
        totalCharge += charge * item.quantity * item.duration * (1 - disc / 100);
      }
    }
  } else {
    // ITEMIZED mode — respect group-level cost/charge overrides
    const groupCostHandled = new Set<string>();
    const groupChargeHandled = new Set<string>();

    for (const group of groups) {
      if (group.cost != null) {
        totalCost += Number(group.cost) * group.quantity;
        groupCostHandled.add(group.id);
      }
      if (group.charge != null) {
        totalCharge += Number(group.charge) * group.quantity;
        groupChargeHandled.add(group.id);
      }
    }

    for (const item of items) {
      const qty = item.quantity;
      const dur = item.duration;

      // Cost: skip items in groups with flat cost
      if (!(item.groupId && groupCostHandled.has(item.groupId))) {
        totalCost += Number(item.unitCost) * qty * dur;
      }

      // Charge: skip items in groups with flat charge
      if (!(item.groupId && groupChargeHandled.has(item.groupId))) {
        const disc = Number(item.discount);
        totalCharge += Number(item.unitCharge) * qty * dur * (1 - disc / 100);
      }
    }
  }

  await prisma.subHire.update({
    where: { id: subHireId },
    data: {
      totalCost: roundCurrency(totalCost),
      totalCharge: roundCurrency(totalCharge),
    },
  });
}

// ─── Line Item Generation + Sync ─────────────────────────────────────────────

// Resolve where a line item should be placed on the project.
// Priority: entity-level target > order-level default > uncategorized.
// When targetGroupId is set, categoryId is resolved from the group.
function resolvePlacement(
  entity: { targetGroupId?: string | null; targetCategoryId?: string | null },
  orderDefaults: { defaultTargetGroupId?: string | null; defaultTargetCategoryId?: string | null },
  groupCategoryMap: Map<string, string | null>, // projectGroupId → categoryId (null for uncategorised groups)
): { groupId: string | null; categoryId: string | null } {
  const gId = entity.targetGroupId ?? orderDefaults.defaultTargetGroupId ?? null;
  if (gId) {
    return { groupId: gId, categoryId: groupCategoryMap.get(gId) ?? null };
  }
  const cId = entity.targetCategoryId ?? orderDefaults.defaultTargetCategoryId ?? null;
  return { groupId: null, categoryId: cId };
}

async function generateSubHireLineItemsTx(
  tx: Prisma.TransactionClient,
  subHireId: string,
  organizationId: string,
) {
  const subHire = await tx.subHire.findUniqueOrThrow({
    where: { id: subHireId },
    include: {
      groups: {
        include: { items: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!subHire.projectId) {
    throw new Error("Cannot generate line items without a project");
  }

  // Always clean up existing line items first to prevent duplicates
  await tx.projectLineItem.deleteMany({
    where: { subHireId },
  });

  // Build a map of projectGroupId → categoryId for placement resolution
  const targetGroupIds = new Set<string>();
  if (subHire.defaultTargetGroupId) targetGroupIds.add(subHire.defaultTargetGroupId);
  for (const g of subHire.groups) {
    if (g.targetGroupId) targetGroupIds.add(g.targetGroupId);
  }
  for (const i of subHire.items) {
    if (i.targetGroupId) targetGroupIds.add(i.targetGroupId);
  }
  const groupCategoryMap = new Map<string, string | null>();
  if (targetGroupIds.size > 0) {
    const projectGroups = await tx.projectGroup.findMany({
      where: { id: { in: [...targetGroupIds] } },
      select: { id: true, categoryId: true },
    });
    for (const pg of projectGroups) {
      groupCategoryMap.set(pg.id, pg.categoryId);
    }
  }

  const orderDefaults = {
    defaultTargetGroupId: subHire.defaultTargetGroupId,
    defaultTargetCategoryId: subHire.defaultTargetCategoryId,
  };

  // Get next sort order on the project
  const maxSort = await tx.projectLineItem.aggregate({
    where: { projectId: subHire.projectId, organizationId },
    _max: { sortOrder: true },
  });
  let nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  // Track project groups that received items (for suggestedPrice recalc)
  const affectedProjectGroupIds = new Set<string>();

  const groupedItemIds = new Set<string>();

  // 1. Generate grouped items — each sub-hire group becomes a parent with children
  for (const group of subHire.groups) {
    if (group.items.length === 0) continue;
    // Skip groups that shouldn't appear on quotes
    if (!group.showOnQuote) {
      for (const item of group.items) groupedItemIds.add(item.id);
      continue;
    }

    const placement = resolvePlacement(group, orderDefaults, groupCategoryMap);
    if (placement.groupId) affectedProjectGroupIds.add(placement.groupId);

    // showSubhireOnDocs: use group-level toggle, falling back to any item's showOnDocs
    const showAsSubhired = group.showOnDocs || group.items.some((i) => i.showOnDocs);

    // Group pricing: if charge is set, parent uses KIT_PRICE mode (like project groups)
    const hasGroupCharge = group.charge != null;
    const groupCharge = hasGroupCharge ? Number(group.charge) : 0;
    const groupLineTotal = hasGroupCharge ? roundCurrency(groupCharge * group.quantity) : 0;

    // Create parent line item for the group
    const parent = await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId: subHire.projectId,
        type: "EQUIPMENT",
        description: group.title,
        quantity: group.quantity,
        unitPrice: hasGroupCharge ? groupCharge : 0,
        lineTotal: groupLineTotal,
        pricingMode: hasGroupCharge ? "KIT_PRICE" : "ITEMIZED",
        subHireId: subHire.id,
        subHireGroupId: group.id,
        supplierId: subHire.supplierId,
        showSubhireOnDocs: showAsSubhired,
        subhireOrderNumber: subHire.orderNumber,
        categoryId: placement.categoryId,
        groupId: placement.groupId,
        sortOrder: nextSort++,
      },
    });

    // Create child line items for each item in the group
    // Children inherit the same categoryId/groupId as the parent so they appear
    // in the correct project group on the equipment tab.
    for (const item of group.items) {
      groupedItemIds.add(item.id);
      const chargeAfterDiscount =
        Number(item.unitCharge) * (1 - Number(item.discount) / 100);
      const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

      await tx.projectLineItem.create({
        data: {
          organizationId,
          projectId: subHire.projectId,
          type: "EQUIPMENT",
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitCharge,
          pricingType: item.pricingType,
          duration: item.duration,
          discount: item.discount,
          lineTotal,
          isKitChild: true,
          parentLineItemId: parent.id,
          subHireId: subHire.id,
          subHireItemId: item.id,
          supplierId: subHire.supplierId,
          showSubhireOnDocs: item.showOnDocs,
          subhireOrderNumber: subHire.orderNumber,
          modelId: item.modelId,
          categoryId: placement.categoryId,
          groupId: placement.groupId,
          sortOrder: nextSort++,
        },
      });
    }
  }

  // 2. Generate ungrouped items as standalone line items
  for (const item of subHire.items) {
    if (groupedItemIds.has(item.id)) continue;
    if (item.groupId) continue; // double-check: skip items with groupId
    if (!item.showOnQuote) continue; // Skip items that shouldn't appear on quotes

    const placement = resolvePlacement(item, orderDefaults, groupCategoryMap);
    if (placement.groupId) affectedProjectGroupIds.add(placement.groupId);

    const chargeAfterDiscount =
      Number(item.unitCharge) * (1 - Number(item.discount) / 100);
    const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

    await tx.projectLineItem.create({
      data: {
        organizationId,
        projectId: subHire.projectId,
        type: "EQUIPMENT",
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitCharge,
        pricingType: item.pricingType,
        duration: item.duration,
        discount: item.discount,
        lineTotal,
        subHireId: subHire.id,
        subHireItemId: item.id,
        supplierId: subHire.supplierId,
        showSubhireOnDocs: item.showOnDocs,
        subhireOrderNumber: subHire.orderNumber,
        modelId: item.modelId,
        categoryId: placement.categoryId,
        groupId: placement.groupId,
        sortOrder: nextSort++,
      },
    });
  }

  // Recalculate suggestedPrice on any project groups that received items
  if (affectedProjectGroupIds.size > 0) {
    const { calculateSuggestedPrice } = await import("@/server/project-groups");
    for (const pgId of affectedProjectGroupIds) {
      await calculateSuggestedPrice(pgId);
    }
  }
}

async function syncNewSubHireLineItem(
  subHire: { id: string; projectId: string | null; supplierId: string; orderNumber: string; status: string; defaultTargetGroupId?: string | null; defaultTargetCategoryId?: string | null },
  item: { id: string; groupId: string | null; description: string; quantity: number; unitCharge: Prisma.Decimal; pricingType: PricingType; duration: number; discount: Prisma.Decimal; modelId: string | null; showOnDocs: boolean; targetGroupId?: string | null; targetCategoryId?: string | null },
) {
  if (!subHire.projectId) return;

  const { organizationId } = await getOrgContext();

  const chargeAfterDiscount =
    Number(item.unitCharge) * (1 - Number(item.discount) / 100);
  const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

  // If item belongs to a sub-hire group, find the parent line item and create as child
  let parentLineItemId: string | null = null;
  let isKitChild = false;
  let placementGroupId: string | null = null;
  let placementCategoryId: string | null = null;

  if (item.groupId) {
    const parentLineItem = await prisma.projectLineItem.findFirst({
      where: { subHireGroupId: item.groupId },
    });
    if (parentLineItem) {
      parentLineItemId = parentLineItem.id;
      isKitChild = true;
      // Children inherit placement from parent (no independent placement)
    }
  } else {
    // Ungrouped item — resolve placement
    const orderDefaults = {
      defaultTargetGroupId: subHire.defaultTargetGroupId ?? null,
      defaultTargetCategoryId: subHire.defaultTargetCategoryId ?? null,
    };

    // Build group→category map for any referenced project groups
    const groupCategoryMap = new Map<string, string | null>();
    const gId = item.targetGroupId ?? orderDefaults.defaultTargetGroupId;
    if (gId) {
      const pg = await prisma.projectGroup.findUnique({
        where: { id: gId },
        select: { categoryId: true },
      });
      if (pg) groupCategoryMap.set(gId, pg.categoryId);
    }

    const placement = resolvePlacement(
      { targetGroupId: item.targetGroupId, targetCategoryId: item.targetCategoryId },
      orderDefaults,
      groupCategoryMap,
    );
    placementGroupId = placement.groupId;
    placementCategoryId = placement.categoryId;
  }

  const maxSort = await prisma.projectLineItem.aggregate({
    where: { projectId: subHire.projectId, organizationId },
    _max: { sortOrder: true },
  });

  await prisma.projectLineItem.create({
    data: {
      organizationId,
      projectId: subHire.projectId,
      type: "EQUIPMENT",
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitCharge,
      pricingType: item.pricingType,
      duration: item.duration,
      discount: item.discount,
      lineTotal,
      isKitChild,
      parentLineItemId,
      subHireId: subHire.id,
      subHireItemId: item.id,
      supplierId: subHire.supplierId,
      showSubhireOnDocs: item.showOnDocs,
      subhireOrderNumber: subHire.orderNumber,
      modelId: item.modelId,
      categoryId: placementCategoryId,
      groupId: placementGroupId,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });

  // Recalculate affected project group's suggestedPrice
  if (placementGroupId) {
    const { calculateSuggestedPrice } = await import("@/server/project-groups");
    await calculateSuggestedPrice(placementGroupId);
  }

  const { recalculateProjectTotals } = await import("@/server/line-items");
  await recalculateProjectTotals(subHire.projectId);
}

async function syncSubHireLineItem(subHireItemId: string, projectId: string | null) {
  if (!projectId) return;

  const item = await prisma.subHireItem.findUnique({
    where: { id: subHireItemId },
    select: {
      description: true,
      quantity: true,
      unitCharge: true,
      pricingType: true,
      duration: true,
      discount: true,
      modelId: true,
      showOnDocs: true,
    },
  });
  if (!item) return;

  const linkedLineItem = await prisma.projectLineItem.findFirst({
    where: { subHireItemId, projectId },
  });
  if (!linkedLineItem) return;

  const chargeAfterDiscount =
    Number(item.unitCharge) * (1 - Number(item.discount) / 100);
  const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

  await prisma.projectLineItem.update({
    where: { id: linkedLineItem.id },
    data: {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitCharge,
      pricingType: item.pricingType,
      duration: item.duration,
      discount: item.discount,
      lineTotal,
      modelId: item.modelId,
      showSubhireOnDocs: item.showOnDocs,
    },
  });

  const { recalculateProjectTotals } = await import("@/server/line-items");
  await recalculateProjectTotals(projectId);
}

export async function changeSubHireProject(subHireId: string, newProjectId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const subHire = await prisma.subHire.findUnique({
    where: { id: subHireId, organizationId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!subHire) throw new Error("Sub-hire not found");
  // Supplier lives in Convex — fetch for the log label.
  const supplierName = (await getSupplierById(subHire.supplierId))?.name ?? "";

  const oldProjectId = subHire.projectId;

  // Verify new project exists in same org
  const newProject = await getProjectById(newProjectId);
  if (!newProject || newProject.organizationId !== organizationId) throw new Error("Project not found");

  await prisma.$transaction(async (tx) => {
    // Delete old line items if they exist
    if (oldProjectId) {
      await tx.projectLineItem.deleteMany({
        where: { subHireId },
      });
    }

    // Update project FK
    await tx.subHire.update({
      where: { id: subHireId },
      data: { projectId: newProjectId },
    });

    // Generate new line items if confirmed or on-hire
    if (subHire.status === "CONFIRMED" || subHire.status === "ON_HIRE") {
      // Need to temporarily update the subHire's projectId for generation
      await generateSubHireLineItemsTx(tx, subHireId, organizationId);
    }
  });

  // Recalculate totals on both projects
  const { recalculateProjectTotals } = await import("@/server/line-items");
  if (oldProjectId) {
    await recalculateProjectTotals(oldProjectId);
  }
  await recalculateProjectTotals(newProjectId);

  // Mirror the project move: sub-hire head + line items on both projects. (The
  // old project's regenerated line items orphan their pre-move rows in Convex —
  // the documented regenerate limitation; decommission re-sync clears them.)
  await syncSubHireToConvex(subHireId);
  await upsertProjectLineItemsToConvex(oldProjectId);
  await upsertProjectLineItemsToConvex(newProjectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: `${subHire.orderNumber} (${supplierName})`,
    summary: `Moved sub-hire ${subHire.orderNumber} to project ${newProject.projectNumber}`,
  });

  const movedSubHire = await prisma.subHire.findUnique({
    where: { id: subHireId },
    include: {
      project: { select: { id: true, name: true, projectNumber: true } },
    },
  });
  // Supplier lives in Convex — attach instead of a Prisma join.
  const supplier = movedSubHire ? await getSupplierById(movedSubHire.supplierId) : null;
  return serialize(movedSubHire ? { ...movedSubHire, supplier } : movedSubHire);
}

// ─── Group CRUD ─────────────────────────────────────────────────────────────

export async function createSubHireGroup(subHireId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireGroupSchema.parse(input);

  const subHire = await prisma.subHire.findUnique({
    where: { id: subHireId, organizationId },
    select: { id: true, orderNumber: true, projectId: true },
  });
  if (!subHire) throw new Error("Sub-hire not found");

  const maxSort = await prisma.subHireGroup.aggregate({
    where: { subHireId },
    _max: { sortOrder: true },
  });

  const group = await prisma.subHireGroup.create({
    data: {
      subHireId,
      title: data.title,
      quantity: data.quantity ?? 1,
      cost: data.cost != null ? data.cost : null,
      charge: data.charge != null ? data.charge : null,
      showOnQuote: data.showOnQuote ?? true,
      showOnDocs: data.showOnDocs ?? false,
      sortOrder: data.sortOrder ?? ((maxSort._max.sortOrder ?? -1) + 1),
      targetCategoryId: data.targetCategoryId || null,
      targetGroupId: data.targetGroupId || null,
    },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  // Sync line items to project (group structure may have changed)
  await syncSubHireToProject(subHireId, organizationId, subHire.projectId);
  await syncSubHireToConvex(subHireId);
  await upsertProjectLineItemsToConvex(subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: subHire.orderNumber,
    summary: `Created group "${data.title}" on ${subHire.orderNumber}`,
  });

  // Model lives in Convex — enrich group items after create.
  const modelMap = await getModelMap(organizationId);
  const enrichedGroup = {
    ...group,
    items: group.items.map((item) => ({
      ...item,
      model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
    })),
  };
  return serialize(enrichedGroup);
}

export async function updateSubHireGroup(groupId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireGroupSchema.parse(input);

  const existing = await prisma.subHireGroup.findUnique({
    where: { id: groupId },
    include: {
      subHire: { select: { id: true, organizationId: true, orderNumber: true, status: true, projectId: true } },
    },
  });
  if (!existing || existing.subHire.organizationId !== organizationId) {
    throw new Error("Sub-hire group not found");
  }

  const group = await prisma.subHireGroup.update({
    where: { id: groupId },
    data: {
      title: data.title,
      quantity: data.quantity ?? undefined,
      cost: data.cost !== undefined ? (data.cost != null ? data.cost : null) : undefined,
      charge: data.charge !== undefined ? (data.charge != null ? data.charge : null) : undefined,
      showOnQuote: data.showOnQuote,
      showOnDocs: data.showOnDocs,
      sortOrder: data.sortOrder,
      targetCategoryId: data.targetCategoryId !== undefined ? (data.targetCategoryId || null) : undefined,
      targetGroupId: data.targetGroupId !== undefined ? (data.targetGroupId || null) : undefined,
    },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  // Recalculate sub-hire totals (group cost/charge may have changed)
  await recalculateSubHireTotals(existing.subHire.id);

  // Sync line items to project (title, placement, pricing may have changed)
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);
  await syncSubHireToConvex(existing.subHire.id);
  await upsertProjectLineItemsToConvex(existing.subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: existing.subHire.id,
    entityName: existing.subHire.orderNumber,
    summary: `Updated group "${data.title}" on ${existing.subHire.orderNumber}`,
  });

  // Model lives in Convex — enrich group items after update.
  const modelMap = await getModelMap(organizationId);
  const enrichedGroup = {
    ...group,
    items: group.items.map((item) => ({
      ...item,
      model: item.modelId ? (modelMap.get(item.modelId) ?? null) : null,
    })),
  };
  return serialize(enrichedGroup);
}

export async function deleteSubHireGroup(groupId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const existing = await prisma.subHireGroup.findUnique({
    where: { id: groupId },
    include: {
      subHire: { select: { id: true, organizationId: true, orderNumber: true, status: true, projectId: true } },
      items: { select: { id: true } },
    },
  });
  if (!existing || existing.subHire.organizationId !== organizationId) {
    throw new Error("Sub-hire group not found");
  }

  await prisma.$transaction(async (tx) => {
    // Ungroup all items (they become ungrouped within the sub-hire)
    await tx.subHireItem.updateMany({
      where: { groupId },
      data: { groupId: null },
    });
    // Delete the group
    await tx.subHireGroup.delete({ where: { id: groupId } });
  });

  // Regenerate line items (handles parent cleanup + ungrouped restructure)
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);
  await removeSubHireGroupFromConvex(groupId);
  await syncSubHireToConvex(existing.subHire.id);
  await upsertProjectLineItemsToConvex(existing.subHire.projectId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "subHire",
    entityId: existing.subHire.id,
    entityName: existing.subHire.orderNumber,
    summary: `Deleted group from ${existing.subHire.orderNumber}`,
  });
}

export async function setItemGroup(itemId: string, groupId: string | null) {
  const { organizationId } = await requirePermission("subHire", "update");

  const existing = await prisma.subHireItem.findUnique({
    where: { id: itemId },
    include: {
      subHire: { select: { id: true, organizationId: true, projectId: true } },
    },
  });
  if (!existing || existing.subHire.organizationId !== organizationId) {
    throw new Error("Sub-hire item not found");
  }

  // Update the item's group
  await prisma.subHireItem.update({
    where: { id: itemId },
    data: { groupId },
  });

  // Regenerate line items (handles parent-child restructuring)
  await syncSubHireToProject(existing.subHire.id, organizationId, existing.subHire.projectId);
  await syncSubHireToConvex(existing.subHire.id);
  await upsertProjectLineItemsToConvex(existing.subHire.projectId);

  return serialize({ success: true });
}

export async function updateSubHireOrderPricing(subHireId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireOrderPricingSchema.parse(input);

  const subHire = await prisma.subHire.findUnique({
    where: { id: subHireId, organizationId },
    select: { id: true, orderNumber: true, projectId: true },
  });
  if (!subHire) throw new Error("Sub-hire not found");

  await prisma.subHire.update({
    where: { id: subHireId },
    data: {
      pricingMode: data.pricingMode as SubHirePricingMode,
      orderTotalCost: data.orderTotalCost != null ? data.orderTotalCost : null,
      orderTotalCharge: data.orderTotalCharge != null ? data.orderTotalCharge : null,
    },
  });

  await recalculateSubHireTotals(subHireId);

  // Recalculate project totals so sub-hire costs flow into margin
  if (subHire.projectId) {
    const { recalculateProjectTotals } = await import("@/server/line-items");
    await recalculateProjectTotals(subHire.projectId);
  }
  await syncSubHireToConvex(subHireId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: subHire.orderNumber,
    summary: `Changed pricing mode to ${data.pricingMode} on ${subHire.orderNumber}`,
  });

  return serialize({ success: true });
}

// ─── Placement ──────────────────────────────────────────────────────────────

export async function updateSubHirePlacement(
  entityType: "order" | "group" | "item",
  entityId: string,
  input: unknown,
) {
  const { organizationId } = await requirePermission("subHire", "update");
  const data = subHirePlacementSchema.parse(input);

  let subHireId: string;
  let projectId: string | null;

  if (entityType === "order") {
    const subHire = await prisma.subHire.findUnique({
      where: { id: entityId, organizationId },
      select: { id: true, projectId: true },
    });
    if (!subHire) throw new Error("Sub-hire not found");
    subHireId = subHire.id;
    projectId = subHire.projectId;

    await prisma.subHire.update({
      where: { id: entityId },
      data: {
        defaultTargetCategoryId: data.targetCategoryId || null,
        defaultTargetGroupId: data.targetGroupId || null,
      },
    });
  } else if (entityType === "group") {
    const group = await prisma.subHireGroup.findUnique({
      where: { id: entityId },
      include: { subHire: { select: { id: true, organizationId: true, projectId: true } } },
    });
    if (!group || group.subHire.organizationId !== organizationId) {
      throw new Error("Sub-hire group not found");
    }
    subHireId = group.subHire.id;
    projectId = group.subHire.projectId;

    await prisma.subHireGroup.update({
      where: { id: entityId },
      data: {
        targetCategoryId: data.targetCategoryId || null,
        targetGroupId: data.targetGroupId || null,
      },
    });
  } else {
    const item = await prisma.subHireItem.findUnique({
      where: { id: entityId },
      include: { subHire: { select: { id: true, organizationId: true, projectId: true } } },
    });
    if (!item || item.subHire.organizationId !== organizationId) {
      throw new Error("Sub-hire item not found");
    }
    subHireId = item.subHire.id;
    projectId = item.subHire.projectId;

    await prisma.subHireItem.update({
      where: { id: entityId },
      data: {
        targetCategoryId: data.targetCategoryId || null,
        targetGroupId: data.targetGroupId || null,
      },
    });
  }

  // Regenerate line items with new placements
  await syncSubHireToProject(subHireId, organizationId, projectId);
  await syncSubHireToConvex(subHireId);
  await upsertProjectLineItemsToConvex(projectId);

  return serialize({ success: true });
}

// Helper: delete all line items for a sub-hire and regenerate from scratch
/**
 * Sync all sub-hire line items to the project. Works for any status (including DRAFT).
 * If the sub-hire has no projectId, this is a no-op.
 */
async function syncSubHireToProject(subHireId: string, organizationId: string, projectId: string | null) {
  if (!projectId) return;
  await regenerateSubHireLineItems(subHireId, organizationId, projectId);
}

async function regenerateSubHireLineItems(subHireId: string, organizationId: string, projectId: string) {
  await prisma.$transaction(async (tx) => {
    // generateSubHireLineItemsTx handles cleanup internally
    await generateSubHireLineItemsTx(tx, subHireId, organizationId);
  });

  const { recalculateProjectTotals } = await import("@/server/line-items");
  await recalculateProjectTotals(projectId);
}

// ─── Supplier Rate Memory ────────────────────────────────────────────────────

async function upsertSupplierModelRate(
  organizationId: string,
  supplierId: string,
  modelId: string,
  unitCost: number,
  pricingType: PricingType,
) {
  await prisma.supplierModelRate.upsert({
    where: {
      organizationId_supplierId_modelId: {
        organizationId,
        supplierId,
        modelId,
      },
    },
    create: {
      organizationId,
      supplierId,
      modelId,
      lastUnitCost: unitCost,
      pricingType,
    },
    update: {
      lastUnitCost: unitCost,
      pricingType,
      lastUsedAt: new Date(),
    },
  });
}

export async function getSupplierModelRate(supplierId: string, modelId: string) {
  const { organizationId } = await getOrgContext();

  const rate = await prisma.supplierModelRate.findUnique({
    where: {
      organizationId_supplierId_modelId: {
        organizationId,
        supplierId,
        modelId,
      },
    },
  });

  return rate ? serialize(rate) : null;
}

export async function getSupplierRateHistory(modelId: string) {
  const { organizationId } = await getOrgContext();

  const rates = await prisma.supplierModelRate.findMany({
    where: { organizationId, modelId },
    orderBy: { lastUnitCost: "asc" },
  });

  // Supplier lives in Convex — attach instead of a Prisma join.
  const ratesWithSupplier = await attachSupplier(organizationId, rates);
  return serialize(ratesWithSupplier);
}

// ─── Quick Duplicate ─────────────────────────────────────────────────────────

export async function duplicateSubHire(sourceId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "create");

  const source = await prisma.subHire.findUnique({
    where: { id: sourceId, organizationId },
    include: {
      groups: { orderBy: { sortOrder: "asc" } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!source) throw new Error("Sub-hire not found");

  const result = await prisma.$transaction(async (tx) => {
    const orderNumber = await reserveSubHireOrderNumber(tx, organizationId);

    const newSubHire = await tx.subHire.create({
      data: {
        organizationId,
        supplierId: source.supplierId,
        projectId: null,
        createdById: userId,
        orderNumber,
        status: "DRAFT",
        hireStart: null,
        hireEnd: null,
        pricingMode: source.pricingMode,
        orderTotalCost: source.orderTotalCost,
        orderTotalCharge: source.orderTotalCharge,
        showOnDocs: source.showOnDocs,
        notes: source.notes,
        totalCost: source.totalCost,
        totalCharge: source.totalCharge,
      },
    });

    // Copy groups and build old→new ID mapping
    const groupIdMap = new Map<string, string>();
    for (const group of source.groups) {
      const newGroup = await tx.subHireGroup.create({
        data: {
          subHireId: newSubHire.id,
          title: group.title,
          quantity: group.quantity,
          cost: group.cost,
          charge: group.charge,
          showOnQuote: group.showOnQuote,
          showOnDocs: group.showOnDocs,
          sortOrder: group.sortOrder,
          // Placement targets are NOT copied (new DRAFT starts uncategorized)
        },
      });
      groupIdMap.set(group.id, newGroup.id);
    }

    // Copy items with mapped groupIds
    for (const item of source.items) {
      await tx.subHireItem.create({
        data: {
          subHireId: newSubHire.id,
          groupId: item.groupId ? groupIdMap.get(item.groupId) || null : null,
          modelId: item.modelId,
          description: item.description,
          quantity: item.quantity,
          unitCost: item.unitCost,
          unitCharge: item.unitCharge,
          pricingType: item.pricingType,
          duration: item.duration,
          discount: item.discount,
          showOnQuote: item.showOnQuote,
          showOnDocs: item.showOnDocs,
          sortOrder: item.sortOrder,
          // Placement targets are NOT copied (new DRAFT starts uncategorized)
        },
      });
    }

    return newSubHire;
  });
  // Mirror the duplicated sub-hire (head + copied groups + items) to Convex.
  await syncSubHireToConvex(result.id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: result.id,
    entityName: result.orderNumber,
    summary: `Duplicated sub-hire from ${source.orderNumber} to ${result.orderNumber}`,
    details: { sourceId: source.id },
  });

  return serialize(result);
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export async function getSubHireDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [activeCount, monthlyAgg, overdueCount] = await Promise.all([
    prisma.subHire.count({
      where: {
        organizationId,
        status: { in: ["CONFIRMED", "ON_HIRE"] },
      },
    }),
    prisma.subHire.aggregate({
      where: {
        organizationId,
        hireStart: { gte: monthStart },
        status: { not: "CANCELLED" },
      },
      _sum: { totalCost: true },
    }),
    prisma.subHire.count({
      where: {
        organizationId,
        status: "ON_HIRE",
        hireEnd: { lt: now },
      },
    }),
  ]);

  return serialize({
    activeSubHires: activeCount,
    monthlySubHireCost: monthlyAgg._sum.totalCost ? Number(monthlyAgg._sum.totalCost) : 0,
    overdueReturns: overdueCount,
  });
}

// ─── Shortage Pre-Check ──────────────────────────────────────────────────────

export async function checkSubHireOpportunity(
  modelId: string,
  quantity: number,
  projectId: string,
  rentalStartDate?: string | null,
  rentalEndDate?: string | null,
) {
  const { organizationId } = await getOrgContext();

  // Use the existing checkAvailability function
  const { checkAvailability } = await import("@/server/line-items");
  const availability = await checkAvailability(modelId, rentalStartDate, rentalEndDate, projectId);

  const available = availability.available ?? 0;

  if (quantity <= available) {
    return serialize({ shortage: false as const });
  }

  // Model lives in Convex — fetch by id for the dialog.
  const model = await getModelById(modelId);

  return serialize({
    shortage: true as const,
    requested: quantity,
    available,
    shortfall: quantity - available,
    modelId,
    modelName: model?.name || "Unknown",
  });
}

// ─── Payment Status ─────────────────────────────────────────────────────────

export async function updateSubHirePaymentStatus(id: string, paymentStatus: SubHirePaymentStatus) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const subHire = await prisma.subHire.findUnique({
    where: { id, organizationId },
  });
  if (!subHire) throw new Error("Sub-hire not found");
  // Supplier lives in Convex — fetch for the log label.
  const supplierName = (await getSupplierById(subHire.supplierId))?.name ?? "";

  await prisma.subHire.update({
    where: { id, organizationId },
    data: { paymentStatus },
  });
  await syncSubHireToConvex(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${supplierName})`,
    summary: `Updated payment status to ${paymentStatus.replace(/_/g, " ").toLowerCase()} on ${subHire.orderNumber}`,
  });

  return serialize({ success: true });
}

// ─── Media / Attachments ────────────────────────────────────────────────────

export async function getSubHireMedia(subHireId: string) {
  const { organizationId } = await requirePermission("subHire", "read");

  const media = await prisma.subHireMedia.findMany({
    where: { subHireId, organizationId },
    include: { file: true },
    orderBy: { sortOrder: "asc" },
  });

  return serialize(media);
}

export async function addSubHireMedia(data: {
  subHireId: string;
  fileId: string;
  type?: MediaType;
  displayName?: string;
}) {
  const { organizationId } = await requirePermission("subHire", "update");

  const subHire = await prisma.subHire.findFirst({
    where: { id: data.subHireId, organizationId },
  });
  if (!subHire) throw new Error("Sub-hire not found");

  const file = await prisma.fileUpload.findFirst({
    where: { id: data.fileId, organizationId },
  });
  if (!file) throw new Error("File not found");

  const maxSort = await prisma.subHireMedia.aggregate({
    where: { subHireId: data.subHireId },
    _max: { sortOrder: true },
  });

  const media = await prisma.subHireMedia.create({
    data: {
      organizationId,
      subHireId: data.subHireId,
      fileId: data.fileId,
      type: data.type || "DOCUMENT",
      displayName: data.displayName,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: { file: true },
  });

  await mirrorMediaCreate("subHire", media);

  return serialize(media);
}

export async function removeSubHireMedia(mediaId: string) {
  const { organizationId } = await requirePermission("subHire", "update");

  const media = await prisma.subHireMedia.findFirst({
    where: { id: mediaId, organizationId },
    include: { file: true },
  });
  if (!media) throw new Error("Media not found");

  await prisma.subHireMedia.delete({ where: { id: mediaId } });

  try {
    await deleteFromS3(media.file.storageKey);
    if (media.file.thumbnailUrl) {
      const thumbKey = media.file.thumbnailUrl.split("/").slice(-2).join("/");
      await deleteFromS3(thumbKey);
    }
  } catch {
    // S3 deletion is best-effort
  }

  // Clean up the file upload record
  const otherUsages = await prisma.$queryRaw`
    SELECT 1 FROM model_media WHERE "fileId" = ${media.fileId}
    UNION ALL SELECT 1 FROM asset_media WHERE "fileId" = ${media.fileId}
    UNION ALL SELECT 1 FROM kit_media WHERE "fileId" = ${media.fileId}
    UNION ALL SELECT 1 FROM project_media WHERE "fileId" = ${media.fileId}
    UNION ALL SELECT 1 FROM client_media WHERE "fileId" = ${media.fileId}
    UNION ALL SELECT 1 FROM location_media WHERE "fileId" = ${media.fileId}
    LIMIT 1
  ` as unknown[];

  if (otherUsages.length === 0) {
    await prisma.fileUpload.delete({ where: { id: media.fileId } });
    await mirrorFileUploadDelete(media.fileId);
  }

  await syncMediaForParent("subHire", organizationId, media.subHireId);

  return serialize({ success: true });
}
