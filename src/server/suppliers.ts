"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { supplierSchema, type SupplierFormValues } from "@/lib/validations/supplier";
import { logActivity, buildChanges } from "@/lib/activity-log";
import { buildFilterWhere, type FilterValue } from "@/lib/table-utils";
import type { ColumnDef } from "@/components/ui/data-table";

// Column defs for server-side filter building
const filterColumnDefs: ColumnDef<unknown>[] = [
  { id: "isActive", header: "Status", accessorKey: "isActive", filterable: true, filterType: "enum" },
];

export async function getSuppliers() {
  const { organizationId } = await getOrgContext();
  return serialize(
    await prisma.supplier.findMany({
      where: { organizationId, isActive: true },
      include: { _count: { select: { assets: true, orders: true } } },
      orderBy: { name: "asc" },
    })
  );
}

export async function getSuppliersPaginated(params: {
  search?: string;
  filters?: Record<string, FilterValue>;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();
  const { search, filters, page = 1, pageSize = 25, sortBy = "name", sortOrder = "asc" } = params;

  const filterWhere = filters ? buildFilterWhere(filters, filterColumnDefs) : {};

  const where = {
    organizationId,
    ...filterWhere,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { contactName: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { accountNumber: { contains: search, mode: "insensitive" as const } },
            { tags: { hasSome: [search.toLowerCase()] } },
          ],
        }
      : {}),
  };

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      include: {
        _count: { select: { assets: true, orders: true, lineItems: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);

  return serialize({ suppliers, total });
}

export async function getSupplierById(id: string) {
  const { organizationId } = await getOrgContext();
  const supplier = await prisma.supplier.findUnique({
    where: { id, organizationId },
    include: {
      _count: { select: { assets: true, orders: true, lineItems: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          _count: { select: { items: true } },
          project: { select: { id: true, name: true, projectNumber: true } },
        },
      },
    },
  });
  if (!supplier) throw new Error("Supplier not found");
  return serialize(supplier);
}

export async function getSupplierAssets(supplierId: string, params: {
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { page = 1, pageSize = 25 } = params;

  const where = { organizationId, supplierId, isActive: true };

  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: {
        model: { select: { id: true, name: true, manufacturer: true } },
      },
      orderBy: { assetTag: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.asset.count({ where }),
  ]);

  return serialize({ assets, total });
}

export async function getSupplierSubhires(supplierId: string, params: {
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { page = 1, pageSize = 25 } = params;

  // Sub-hire line items now identified by `subHireId != null` (Wave 2).
  const where = { organizationId, supplierId, subHireId: { not: null } };

  const [lineItems, total] = await Promise.all([
    prisma.projectLineItem.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, projectNumber: true, status: true } },
        model: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.projectLineItem.count({ where }),
  ]);

  return serialize({ lineItems, total });
}

export async function createSupplier(data: SupplierFormValues) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "create");
  const parsed = supplierSchema.parse(data);
  const cleaned = {
    ...parsed,
    email: parsed.email || null,
    contactName: parsed.contactName || null,
    phone: parsed.phone || null,
    website: parsed.website || null,
    address: parsed.address || null,
    latitude: parsed.latitude ?? null,
    longitude: parsed.longitude ?? null,
    notes: parsed.notes || null,
    accountNumber: parsed.accountNumber || null,
    paymentTerms: parsed.paymentTerms || null,
    defaultLeadTime: parsed.defaultLeadTime || null,
    tags: (parsed.tags || []).map((t: string) => t.toLowerCase()),
  };
  const result = await prisma.supplier.create({
    data: { ...cleaned, organizationId },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "supplier",
    entityId: result.id,
    entityName: result.name,
    summary: `Created supplier ${result.name}`,
  });

  return serialize(result);
}

export async function updateSupplier(id: string, data: SupplierFormValues) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "update");
  const parsed = supplierSchema.parse(data);

  const before = await prisma.supplier.findUnique({ where: { id, organizationId } });
  if (!before) throw new Error("Supplier not found");

  const cleaned = {
    ...parsed,
    email: parsed.email || null,
    contactName: parsed.contactName || null,
    phone: parsed.phone || null,
    website: parsed.website || null,
    address: parsed.address || null,
    latitude: parsed.latitude ?? null,
    longitude: parsed.longitude ?? null,
    notes: parsed.notes || null,
    accountNumber: parsed.accountNumber || null,
    paymentTerms: parsed.paymentTerms || null,
    defaultLeadTime: parsed.defaultLeadTime || null,
    tags: (parsed.tags || []).map((t: string) => t.toLowerCase()),
  };
  const updated = await prisma.supplier.update({
    where: { id, organizationId },
    data: cleaned,
  });

  const changes = buildChanges(before, updated, [
    "name", "contactName", "email", "phone", "website", "address",
    "notes", "accountNumber", "paymentTerms", "defaultLeadTime", "isActive",
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "supplier",
    entityId: updated.id,
    entityName: updated.name,
    summary: `Updated supplier ${updated.name}`,
    details: changes.length > 0 ? { changes } : undefined,
  });

  return serialize(updated);
}

export async function deleteSupplier(id: string) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "delete");
  const supplier = await prisma.supplier.findUnique({
    where: { id, organizationId },
    include: { _count: { select: { assets: true, lineItems: true, orders: true } } },
  });
  if (!supplier) throw new Error("Supplier not found");
  if (supplier._count.assets > 0) {
    throw new Error("Cannot delete supplier with linked assets");
  }
  if (supplier._count.lineItems > 0) {
    throw new Error("Cannot delete supplier with linked line items");
  }
  if (supplier._count.orders > 0) {
    throw new Error("Cannot delete supplier with existing orders. Archive it instead.");
  }
  await prisma.supplier.delete({ where: { id, organizationId } });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "supplier",
    entityId: id,
    entityName: supplier.name,
    summary: `Deleted supplier ${supplier.name}`,
    details: { deleted: { name: supplier.name } },
  });

  return { success: true };
}
