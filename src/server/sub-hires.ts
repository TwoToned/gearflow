"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { roundCurrency } from "@/lib/formatters";
import { subHireSchema, subHireItemSchema } from "@/lib/validations/sub-hire";
import type { SubHireStatus, PricingType, Prisma } from "@/generated/prisma/client";

// ─── Status Machine ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<SubHireStatus, SubHireStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ON_HIRE", "CANCELLED"],
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
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { organizationId } = await getOrgContext();

  const where: Prisma.SubHireWhereInput = { organizationId };

  if (filters?.status?.length) {
    where.status = { in: filters.status };
  }
  if (filters?.supplierId) {
    where.supplierId = filters.supplierId;
  }
  if (filters?.dateFrom || filters?.dateTo) {
    where.hireStart = {};
    if (filters.dateFrom) where.hireStart.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.hireStart.lte = new Date(filters.dateTo);
  }
  if (filters?.search) {
    const term = filters.search;
    where.OR = [
      { orderNumber: { contains: term, mode: "insensitive" } },
      { supplier: { name: { contains: term, mode: "insensitive" } } },
      { items: { some: { description: { contains: term, mode: "insensitive" } } } },
    ];
  }

  const subHires = await prisma.subHire.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, projectNumber: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return serialize(subHires);
}

export async function getSubHire(id: string) {
  const { organizationId } = await getOrgContext();

  const subHire = await prisma.subHire.findUnique({
    where: { id, organizationId },
    include: {
      supplier: { select: { id: true, name: true, contactEmail: true, contactPhone: true } },
      project: { select: { id: true, name: true, projectNumber: true } },
      createdBy: { select: { id: true, name: true } },
      items: {
        include: {
          model: { select: { id: true, name: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!subHire) throw new Error("Sub-hire not found");
  return serialize(subHire);
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
        status: "DRAFT",
        hireStart: data.hireStart || null,
        hireEnd: data.hireEnd || null,
        showOnDocs: data.showOnDocs,
        notes: data.notes || null,
      },
      include: {
        supplier: { select: { name: true } },
      },
    });

    return subHire;
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "subHire",
    entityId: result.id,
    entityName: `${result.orderNumber} (${result.supplier.name})`,
    summary: `Created sub-hire ${result.orderNumber}`,
  });

  return serialize(result);
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
      hireStart: data.hireStart || null,
      hireEnd: data.hireEnd || null,
      showOnDocs: data.showOnDocs,
      notes: data.notes || null,
    },
    include: {
      supplier: { select: { name: true } },
    },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${subHire.supplier.name})`,
    summary: `Updated sub-hire ${subHire.orderNumber}`,
  });

  return serialize(subHire);
}

export async function deleteSubHire(id: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "delete");

  const subHire = await prisma.subHire.findUnique({
    where: { id, organizationId },
    include: {
      supplier: { select: { name: true } },
      lineItems: { select: { id: true, status: true } },
    },
  });
  if (!subHire) throw new Error("Sub-hire not found");

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
    entityName: `${subHire.orderNumber} (${subHire.supplier.name})`,
    summary: `Deleted sub-hire ${subHire.orderNumber}`,
  });
}

export async function updateSubHireStatus(id: string, newStatus: SubHireStatus) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");

  const subHire = await prisma.subHire.findUnique({
    where: { id, organizationId },
    include: {
      supplier: { select: { name: true } },
      items: true,
    },
  });
  if (!subHire) throw new Error("Sub-hire not found");

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
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: id,
    entityName: `${subHire.orderNumber} (${subHire.supplier.name})`,
    summary: `Changed sub-hire ${subHire.orderNumber} status to ${newStatus}`,
    details: { previousStatus: subHire.status, newStatus },
  });

  return serialize(
    await prisma.subHire.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
        items: {
          include: { model: { select: { id: true, name: true } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
  );
}

// ─── Item CRUD ───────────────────────────────────────────────────────────────

export async function addSubHireItem(subHireId: string, input: unknown) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "update");
  const data = subHireItemSchema.parse(input);

  const subHire = await prisma.subHire.findUnique({
    where: { id: subHireId, organizationId },
    select: { id: true, orderNumber: true, status: true, supplierId: true, projectId: true },
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
      modelId: data.modelId || null,
      description: data.description,
      quantity: data.quantity,
      unitCost: data.unitCost,
      unitCharge: data.unitCharge,
      pricingType: data.pricingType as PricingType,
      duration: data.duration,
      discount: data.discount,
      sortOrder: nextSort,
    },
    include: { model: { select: { id: true, name: true } } },
  });

  await recalculateSubHireTotals(subHireId);

  // Upsert supplier rate if item has a model
  if (data.modelId) {
    await upsertSupplierModelRate(organizationId, subHire.supplierId, data.modelId, data.unitCost, data.pricingType as PricingType);
  }

  // If confirmed/on-hire, sync line item to project
  if (subHire.status === "CONFIRMED" || subHire.status === "ON_HIRE") {
    await syncNewSubHireLineItem(subHire, item);
  }

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

  return serialize(item);
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
      modelId: data.modelId || null,
      description: data.description,
      quantity: data.quantity,
      unitCost: data.unitCost,
      unitCharge: data.unitCharge,
      pricingType: data.pricingType as PricingType,
      duration: data.duration,
      discount: data.discount,
    },
    include: { model: { select: { id: true, name: true } } },
  });

  await recalculateSubHireTotals(existing.subHire.id);

  // Upsert supplier rate if item has a model
  if (data.modelId) {
    await upsertSupplierModelRate(organizationId, existing.subHire.supplierId, data.modelId, data.unitCost, data.pricingType as PricingType);
  }

  // If confirmed/on-hire, sync the linked project line item
  if (existing.subHire.status === "CONFIRMED" || existing.subHire.status === "ON_HIRE") {
    await syncSubHireLineItem(itemId, existing.subHire.projectId);
  }

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

  return serialize(item);
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

  // Delete linked project line items, then the item itself
  await prisma.$transaction(async (tx) => {
    if (existing.lineItems.length > 0) {
      await tx.projectLineItem.deleteMany({
        where: { subHireItemId: itemId },
      });
    }
    await tx.subHireItem.delete({ where: { id: itemId } });
  });

  await recalculateSubHireTotals(existing.subHire.id);

  if (existing.subHire.projectId) {
    const { recalculateProjectTotals } = await import("@/server/line-items");
    await recalculateProjectTotals(existing.subHire.projectId);
  }

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
        where: { id },
        data: { sortOrder: index },
      }),
    ),
  );
}

// ─── Totals ──────────────────────────────────────────────────────────────────

async function recalculateSubHireTotals(subHireId: string) {
  const items = await prisma.subHireItem.findMany({
    where: { subHireId },
    select: {
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

  for (const item of items) {
    const qty = item.quantity;
    const dur = item.duration;
    const cost = Number(item.unitCost);
    const charge = Number(item.unitCharge);
    const disc = Number(item.discount);

    totalCost += cost * qty * dur;
    totalCharge += charge * qty * dur * (1 - disc / 100);
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

async function generateSubHireLineItemsTx(
  tx: Prisma.TransactionClient,
  subHireId: string,
  organizationId: string,
) {
  const subHire = await tx.subHire.findUniqueOrThrow({
    where: { id: subHireId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!subHire.projectId) {
    throw new Error("Cannot generate line items without a project");
  }

  // Get next sort order on the project
  const maxSort = await tx.projectLineItem.aggregate({
    where: { projectId: subHire.projectId, organizationId },
    _max: { sortOrder: true },
  });
  let nextSort = (maxSort._max.sortOrder ?? -1) + 1;

  for (const item of subHire.items) {
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
        isSubhire: true,
        subHireId: subHire.id,
        subHireItemId: item.id,
        supplierId: subHire.supplierId,
        showSubhireOnDocs: subHire.showOnDocs,
        subhireOrderNumber: subHire.orderNumber,
        modelId: item.modelId,
        sortOrder: nextSort++,
      },
    });
  }
}

async function syncNewSubHireLineItem(
  subHire: { id: string; projectId: string | null; supplierId: string; orderNumber: string; status: string },
  item: { id: string; description: string; quantity: number; unitCharge: Prisma.Decimal; pricingType: PricingType; duration: number; discount: Prisma.Decimal; modelId: string | null },
) {
  if (!subHire.projectId) return;

  const { organizationId } = await getOrgContext();

  const maxSort = await prisma.projectLineItem.aggregate({
    where: { projectId: subHire.projectId, organizationId },
    _max: { sortOrder: true },
  });

  const chargeAfterDiscount =
    Number(item.unitCharge) * (1 - Number(item.discount) / 100);
  const lineTotal = roundCurrency(chargeAfterDiscount * item.quantity * item.duration);

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
      isSubhire: true,
      subHireId: subHire.id,
      subHireItemId: item.id,
      supplierId: subHire.supplierId,
      showSubhireOnDocs: subHire.status === "CONFIRMED" || subHire.status === "ON_HIRE",
      subhireOrderNumber: subHire.orderNumber,
      modelId: item.modelId,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });

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
    },
  });
  if (!item) return;

  const linkedLineItem = await prisma.projectLineItem.findFirst({
    where: { subHireItemId },
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
      supplier: { select: { name: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!subHire) throw new Error("Sub-hire not found");

  const oldProjectId = subHire.projectId;

  // Verify new project exists in same org
  const newProject = await prisma.project.findUnique({
    where: { id: newProjectId, organizationId },
    select: { id: true, name: true, projectNumber: true },
  });
  if (!newProject) throw new Error("Project not found");

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

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "subHire",
    entityId: subHireId,
    entityName: `${subHire.orderNumber} (${subHire.supplier.name})`,
    summary: `Moved sub-hire ${subHire.orderNumber} to project ${newProject.projectNumber}`,
  });

  return serialize(
    await prisma.subHire.findUnique({
      where: { id: subHireId },
      include: {
        supplier: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
      },
    }),
  );
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
    include: {
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { lastUnitCost: "asc" },
  });

  return serialize(rates);
}

// ─── Quick Duplicate ─────────────────────────────────────────────────────────

export async function duplicateSubHire(sourceId: string) {
  const { organizationId, userId, userName } = await requirePermission("subHire", "create");

  const source = await prisma.subHire.findUnique({
    where: { id: sourceId, organizationId },
    include: {
      supplier: { select: { name: true } },
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
        showOnDocs: source.showOnDocs,
        notes: source.notes,
        totalCost: source.totalCost,
        totalCharge: source.totalCharge,
      },
    });

    for (const item of source.items) {
      await tx.subHireItem.create({
        data: {
          subHireId: newSubHire.id,
          modelId: item.modelId,
          description: item.description,
          quantity: item.quantity,
          unitCost: item.unitCost,
          unitCharge: item.unitCharge,
          pricingType: item.pricingType,
          duration: item.duration,
          discount: item.discount,
          sortOrder: item.sortOrder,
        },
      });
    }

    return newSubHire;
  });

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

  // Get model name for the dialog
  const model = await prisma.model.findUnique({
    where: { id: modelId, organizationId },
    select: { name: true },
  });

  return serialize({
    shortage: true as const,
    requested: quantity,
    available,
    shortfall: quantity - available,
    modelId,
    modelName: model?.name || "Unknown",
  });
}
