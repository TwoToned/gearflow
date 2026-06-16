"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { supplierOrderSchema, type SupplierOrderFormValues, supplierOrderItemSchema, type SupplierOrderItemFormValues } from "@/lib/validations/supplier-order";
import { logActivity, buildChanges } from "@/lib/activity-log";
import {
  mirrorSupplierOrderCreate,
  patchSupplierOrderInConvex,
  removeSupplierOrderFromConvex,
  removeSupplierOrderItemFromConvex,
  syncSupplierOrderToConvex,
} from "@/lib/sub-hire-mirror";
import {
  attachSupplier,
  getMatchingSupplierIds,
  getSupplierById,
} from "@/lib/suppliers-read";
import { attachModel } from "@/lib/models-read";
import { getAssetsByOrg } from "@/lib/assets-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getSupplierOrdersByOrg,
  getSupplierOrderById as fetchSupplierOrderById,
  getSupplierOrderItems,
  getSupplierOrderItemCounts,
  type SupplierOrderRow,
} from "@/lib/supplier-order-read";
import type { FilterValue } from "@/lib/table-utils";

// Postgres ASC = NULLS LAST, DESC = NULLS FIRST; Dates compared by epoch.
function compareOrders(a: SupplierOrderRow, b: SupplierOrderRow, key: string, dir: 1 | -1): number {
  const raw = (o: SupplierOrderRow) => (o as unknown as Record<string, unknown>)[key];
  const va = raw(a);
  const vb = raw(b);
  const na = va instanceof Date ? va.getTime() : va;
  const nb = vb instanceof Date ? vb.getTime() : vb;
  if (na == null && nb == null) return 0;
  if (na == null) return dir;
  if (nb == null) return -dir;
  if (typeof na === "number" && typeof nb === "number") return dir * (na - nb);
  return dir * String(na).localeCompare(String(nb));
}

export async function getSupplierOrders(params: {
  supplierId?: string;
  type?: string;
  status?: string;
  search?: string;
  filters?: Record<string, FilterValue>;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();
  const { supplierId, type, status, search, page = 1, pageSize = 25, sortBy = "createdAt", sortOrder = "desc" } = params;

  // Orders moved off Prisma to Convex (Phase A). Filter/sort/paginate in JS;
  // project + item-count + supplier attached from Convex. createdBy (User) stays
  // Prisma but is not needed by the list.
  let orders = await getSupplierOrdersByOrg(organizationId);
  if (supplierId) orders = orders.filter((o) => o.supplierId === supplierId);
  if (type) orders = orders.filter((o) => o.type === type);
  if (status) orders = orders.filter((o) => o.status === status);
  if (search) {
    // Supplier lives in Convex — resolve matching supplier ids and fold them into
    // the search as a supplierId predicate. Sort/page is by order columns, never
    // the supplier name, so id-resolution is order-safe here.
    const matchingSupplierIds = new Set(await getMatchingSupplierIds(organizationId, search));
    const q = search.toLowerCase();
    orders = orders.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        (o.notes ?? "").toLowerCase().includes(q) ||
        matchingSupplierIds.has(o.supplierId),
    );
  }

  const total = orders.length;
  const dir: 1 | -1 = sortOrder === "asc" ? 1 : -1;
  orders.sort((a, b) => compareOrders(a, b, sortBy, dir));
  const pageOrders = orders.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const [projects, counts] = await Promise.all([
    getProjectsByOrg(organizationId),
    getSupplierOrderItemCounts(pageOrders.map((o) => o.id)),
  ]);
  const projMap = new Map(projects.map((p) => [p.id, p]));

  const withProjectCount = pageOrders.map((o) => {
    const proj = o.projectId ? projMap.get(o.projectId) : undefined;
    return {
      ...o,
      project: proj ? { id: proj.id, name: proj.name, projectNumber: proj.projectNumber } : null,
      _count: { items: counts.get(o.id) ?? 0 },
    };
  });

  // Attach the Convex supplier docs (replaces the old `include: { supplier }`).
  const ordersWithSupplier = await attachSupplier(organizationId, withProjectCount);
  return serialize({ orders: ordersWithSupplier, total });
}

export async function getSupplierOrderById(id: string) {
  const { organizationId } = await getOrgContext();

  // Order + items moved to Convex (Phase A). project/supplier/model attached from
  // Convex; createdBy (User) stays Prisma (auth). asset attached from Convex.
  const order = await fetchSupplierOrderById(id);
  if (!order || order.organizationId !== organizationId) throw new Error("Order not found");

  const [items, assets, projects] = await Promise.all([
    getSupplierOrderItems(id),
    getAssetsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const itemsWithAsset = items.map((it) => ({
    ...it,
    asset: it.assetId && assetMap.has(it.assetId)
      ? { id: assetMap.get(it.assetId)!.id, assetTag: assetMap.get(it.assetId)!.assetTag }
      : null,
  }));

  const proj = order.projectId ? projects.find((p) => p.id === order.projectId) : undefined;
  const project = proj ? { id: proj.id, name: proj.name, projectNumber: proj.projectNumber } : null;
  const createdBy = order.createdById
    ? await prisma.user.findUnique({ where: { id: order.createdById }, select: { id: true, name: true } })
    : null;

  // Model + supplier live in Convex — attach instead of Prisma joins.
  const [supplier, enrichedItems] = await Promise.all([
    getSupplierById(order.supplierId),
    attachModel(organizationId, itemsWithAsset),
  ]);
  return serialize({ ...order, project, createdBy, items: enrichedItems, supplier });
}

export async function createSupplierOrder(data: SupplierOrderFormValues) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "create");
  const parsed = supplierOrderSchema.parse(data);

  const order = await prisma.supplierOrder.create({
    data: {
      organizationId,
      supplierId: parsed.supplierId,
      orderNumber: parsed.orderNumber,
      type: parsed.type,
      status: parsed.status,
      orderDate: parsed.orderDate ? new Date(parsed.orderDate as unknown as string) : null,
      expectedDate: parsed.expectedDate ? new Date(parsed.expectedDate as unknown as string) : null,
      receivedDate: parsed.receivedDate ? new Date(parsed.receivedDate as unknown as string) : null,
      projectId: parsed.projectId || null,
      notes: parsed.notes || null,
      createdById: userId,
    },
  });
  await mirrorSupplierOrderCreate(order);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "supplierOrder",
    entityId: order.id,
    entityName: order.orderNumber,
    summary: `Created order ${order.orderNumber}`,
  });

  return serialize(order);
}

export async function updateSupplierOrder(id: string, data: Partial<SupplierOrderFormValues>) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "update");

  const before = await prisma.supplierOrder.findUnique({ where: { id, organizationId } });
  if (!before) throw new Error("Order not found");

  const updateData: Record<string, unknown> = {};
  if (data.orderNumber !== undefined) updateData.orderNumber = data.orderNumber;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.orderDate !== undefined) updateData.orderDate = data.orderDate ? new Date(data.orderDate as unknown as string) : null;
  if (data.expectedDate !== undefined) updateData.expectedDate = data.expectedDate ? new Date(data.expectedDate as unknown as string) : null;
  if (data.receivedDate !== undefined) updateData.receivedDate = data.receivedDate ? new Date(data.receivedDate as unknown as string) : null;
  if (data.projectId !== undefined) updateData.projectId = data.projectId || null;
  if (data.notes !== undefined) updateData.notes = data.notes || null;

  const updated = await prisma.supplierOrder.update({
    where: { id, organizationId },
    data: updateData,
  });

  await patchSupplierOrderInConvex(updated.id, updated);

  const changes = buildChanges(before, updated, [
    "orderNumber", "type", "status", "notes",
  ]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "supplierOrder",
    entityId: updated.id,
    entityName: updated.orderNumber,
    summary: `Updated order ${updated.orderNumber}`,
    details: changes.length > 0 ? { changes } : undefined,
  });

  return serialize(updated);
}

export async function updateSupplierOrderStatus(id: string, status: string) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "update");

  const before = await prisma.supplierOrder.findUnique({ where: { id, organizationId } });
  if (!before) throw new Error("Order not found");

  const updateData: Record<string, unknown> = { status };
  if (status === "RECEIVED" && !before.receivedDate) {
    updateData.receivedDate = new Date();
  }

  const updated = await prisma.supplierOrder.update({
    where: { id, organizationId },
    data: updateData,
  });
  await patchSupplierOrderInConvex(updated.id, updated);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "supplierOrder",
    entityId: updated.id,
    entityName: updated.orderNumber,
    summary: `Changed order ${updated.orderNumber} status to ${status}`,
    details: { changes: [{ field: "status", from: before.status, to: status }] },
  });

  return serialize(updated);
}

export async function deleteSupplierOrder(id: string) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "delete");

  const order = await prisma.supplierOrder.findUnique({ where: { id, organizationId } });
  if (!order) throw new Error("Order not found");

  // Capture the cascade-deleted items so we can mirror their removal.
  const itemsToRemove = await prisma.supplierOrderItem.findMany({ where: { orderId: id }, select: { id: true } });
  await prisma.supplierOrder.delete({ where: { id, organizationId } });
  for (const it of itemsToRemove) await removeSupplierOrderItemFromConvex(it.id);
  await removeSupplierOrderFromConvex(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "supplierOrder",
    entityId: id,
    entityName: order.orderNumber,
    summary: `Deleted order ${order.orderNumber}`,
  });

  return { success: true };
}

export async function addOrderItem(orderId: string, data: SupplierOrderItemFormValues) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "update");

  const order = await prisma.supplierOrder.findUnique({ where: { id: orderId, organizationId } });
  if (!order) throw new Error("Order not found");

  const parsed = supplierOrderItemSchema.parse(data);
  const lineTotal = parsed.unitPrice != null ? parsed.unitPrice * parsed.quantity : null;

  const maxSort = await prisma.supplierOrderItem.aggregate({
    where: { orderId },
    _max: { sortOrder: true },
  });

  const item = await prisma.supplierOrderItem.create({
    data: {
      orderId,
      description: parsed.description,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice ?? null,
      lineTotal,
      modelId: parsed.modelId || null,
      assetId: parsed.assetId || null,
      notes: parsed.notes || null,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });

  await recalculateOrderTotals(orderId);
  await syncSupplierOrderToConvex(orderId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "supplierOrderItem",
    entityId: item.id,
    entityName: parsed.description,
    summary: `Added item "${parsed.description}" to order ${order.orderNumber}`,
  });

  return serialize(item);
}

export async function updateOrderItem(itemId: string, data: Partial<SupplierOrderItemFormValues>) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "update");

  const item = await prisma.supplierOrderItem.findUnique({
    where: { id: itemId },
    include: { order: { select: { organizationId: true, orderNumber: true } } },
  });
  if (!item || item.order.organizationId !== organizationId) throw new Error("Item not found");

  const updateData: Record<string, unknown> = {};
  if (data.description !== undefined) updateData.description = data.description;
  if (data.quantity !== undefined) updateData.quantity = data.quantity;
  if (data.unitPrice !== undefined) updateData.unitPrice = data.unitPrice ?? null;
  if (data.modelId !== undefined) updateData.modelId = data.modelId || null;
  if (data.assetId !== undefined) updateData.assetId = data.assetId || null;
  if (data.notes !== undefined) updateData.notes = data.notes || null;

  // Recalculate line total
  const qty = Number(data.quantity ?? item.quantity);
  const price = data.unitPrice !== undefined ? (data.unitPrice ?? null) : (item.unitPrice != null ? Number(item.unitPrice) : null);
  updateData.lineTotal = price != null ? Number(price) * qty : null;

  const updated = await prisma.supplierOrderItem.update({
    where: { id: itemId },
    data: updateData,
  });

  await recalculateOrderTotals(item.orderId);
  await syncSupplierOrderToConvex(item.orderId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "supplierOrderItem",
    entityId: updated.id,
    entityName: updated.description,
    summary: `Updated item "${updated.description}" on order ${item.order.orderNumber}`,
  });

  return serialize(updated);
}

export async function removeOrderItem(itemId: string) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "update");

  const item = await prisma.supplierOrderItem.findUnique({
    where: { id: itemId },
    include: { order: { select: { organizationId: true, orderNumber: true } } },
  });
  if (!item || item.order.organizationId !== organizationId) throw new Error("Item not found");

  await prisma.supplierOrderItem.delete({ where: { id: itemId } });
  await recalculateOrderTotals(item.orderId);
  await removeSupplierOrderItemFromConvex(itemId);
  await syncSupplierOrderToConvex(item.orderId);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "supplierOrderItem",
    entityId: itemId,
    entityName: item.description,
    summary: `Removed item "${item.description}" from order ${item.order.orderNumber}`,
  });

  return { success: true };
}

async function recalculateOrderTotals(orderId: string) {
  const agg = await prisma.supplierOrderItem.aggregate({
    where: { orderId },
    _sum: { lineTotal: true },
  });

  const subtotal = agg._sum.lineTotal ? Number(agg._sum.lineTotal) : 0;
  const taxAmount = Math.round(subtotal * 0.1 * 100) / 100; // 10% GST
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  await prisma.supplierOrder.update({
    where: { id: orderId },
    data: { subtotal, taxAmount, total },
  });
}
