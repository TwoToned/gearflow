"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { roundCurrency } from "@/lib/formatters";
import { subHireSchema, subHireItemSchema } from "@/lib/validations/sub-hire";
import type { SubHireStatus, Prisma } from "@/generated/prisma/client";

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
