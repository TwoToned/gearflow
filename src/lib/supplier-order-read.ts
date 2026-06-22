import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the supplier-order domain (Phase A read-rewiring of
 * the Convex domain-only decommission). `supplierOrder` + `supplierOrderItem` are
 * Convex-only (writes were inverted in Phase A/C). These helpers read the Convex
 * copy and shape it back into the Prisma-row form the supplier-order pages expect
 * (epoch-ms → Date, Decimal → number, absent optionals → null).
 *
 * Cross-domain joins are composed by the caller: supplier via suppliers-read,
 * model via models-read, project via projects-read, `createdBy` (Better Auth User)
 * via Prisma (auth stays Prisma forever).
 */

type RawOrder = Doc<"supplierOrders">;
type RawItem = Doc<"supplierOrderItems">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;

export interface SupplierOrderRow {
  id: string;
  organizationId: string;
  supplierId: string;
  orderNumber: string;
  type: string;
  status: string;
  orderDate: Date | null;
  expectedDate: Date | null;
  receivedDate: Date | null;
  subtotal: number | null;
  taxAmount: number | null;
  total: number | null;
  projectId: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface SupplierOrderItemRow {
  id: string;
  orderId: string;
  description: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
  modelId: string | null;
  assetId: string | null;
  notes: string | null;
  sortOrder: number;
}

export function mapSupplierOrder(d: RawOrder): SupplierOrderRow {
  return {
    id: d.id,
    organizationId: req(d.organizationId),
    supplierId: req(d.supplierId),
    orderNumber: req(d.orderNumber),
    type: req(d.type),
    status: req(d.status),
    orderDate: toDate(d.orderDate),
    expectedDate: toDate(d.expectedDate),
    receivedDate: toDate(d.receivedDate),
    subtotal: orNull(d.subtotal),
    taxAmount: orNull(d.taxAmount),
    total: orNull(d.total),
    projectId: orNull(d.projectId),
    notes: orNull(d.notes),
    createdById: orNull(d.createdById),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function mapSupplierOrderItem(d: RawItem): SupplierOrderItemRow {
  return {
    id: d.id,
    orderId: req(d.orderId),
    description: req(d.description),
    quantity: req(d.quantity),
    unitPrice: orNull(d.unitPrice),
    lineTotal: orNull(d.lineTotal),
    modelId: orNull(d.modelId),
    assetId: orNull(d.assetId),
    notes: orNull(d.notes),
    sortOrder: req(d.sortOrder),
  };
}

export async function getSupplierOrdersByOrg(orgId: string): Promise<SupplierOrderRow[]> {
  const rows = (await (await getConvexClient()).query(api.supplierOrders.list, { orgId })) as RawOrder[];
  return rows.map(mapSupplierOrder);
}

export async function getSupplierOrderById(id: string): Promise<SupplierOrderRow | null> {
  const row = (await (await getConvexClient()).query(api.supplierOrders.getById, { id })) as RawOrder | null;
  return row ? mapSupplierOrder(row) : null;
}

/** Items for one order, sorted by sortOrder asc. */
export async function getSupplierOrderItems(orderId: string): Promise<SupplierOrderItemRow[]> {
  const rows = (await (await getConvexClient()).query(api.supplierOrderItems.list, { orderId })) as RawItem[];
  return rows.map(mapSupplierOrderItem).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Item counts per order id (one round trip) for the list view. */
export async function getSupplierOrderItemCounts(orderIds: string[]): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = (await (await getConvexClient()).query(api.supplierOrderItems.listByOrderIds, {
    orderIds,
  })) as RawItem[];
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.orderId, (counts.get(r.orderId) ?? 0) + 1);
  return counts;
}
