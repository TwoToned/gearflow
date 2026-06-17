"use server";

import { type FunctionArgs } from "convex/server";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { supplierSchema, type SupplierFormValues } from "@/lib/validations/supplier";
import { logActivity, buildChanges } from "@/lib/activity-log";
import { type FilterValue } from "@/lib/table-utils";
import { attachModel } from "@/lib/models-read";
import { getAssetsByOrg } from "@/lib/assets-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getLineItemsByOrg,
  countLineItemsBySupplierMap,
  buildSupplierSubhires,
  type SubhireProjectSelect,
} from "@/lib/line-item-count-read";
import {
  getSupplierOrdersByOrg,
  countSupplierAssetsAndOrders,
  getSupplierById as getConvexSupplierById,
  getMappedSuppliersByOrg,
  mapSupplier,
  supplierMatchesSearch,
  compareSuppliers,
} from "@/lib/suppliers-read";

// Suppliers are DUAL-WRITTEN: every create/update/delete writes the Prisma
// `supplier` row (the durable FK anchor — asset/bulk_asset/project_line_item/
// sub_hire/supplier_order/supplier_model_rate all carry a real FK, two required
// + Cascade) AND the Convex `suppliers` doc (the reactive read source the
// browser subscribes to via use-suppliers). Prisma is written first so it stays
// the integrity anchor and the idempotent backfill can heal a missing Convex
// row; the Convex payload is derived from the written Prisma row via toConvexDoc
// so the two stores can't drift. Server-side reads below stay on the (always
// fresh) Prisma mirror; the reactive UI reads Convex. See FEATUREDOCS/54.

/** Mirror a freshly written Prisma supplier row into Convex (create). */
async function mirrorSupplierToConvex(row: Record<string, unknown>) {
  await (await getConvexClient()).mutation(
    api.suppliers.createIfMissing,
    toConvexDoc(row) as FunctionArgs<typeof api.suppliers.createIfMissing>,
  );
}

/** Mirror an updated Prisma supplier row into Convex (patch, id stripped). */
async function patchSupplierInConvex(id: string, row: Record<string, unknown>) {
  const { id: _id, ...patch } = toConvexDoc(row);
  await (await getConvexClient()).mutation(api.suppliers.update, {
    id,
    patch: patch as FunctionArgs<typeof api.suppliers.update>["patch"],
  });
}

/**
 * Per-supplier `{ assets, orders, lineItems }` counts for an org — all from Convex
 * now (assets via the asset read helper, orders via the supplierOrders list,
 * lineItems via the dual-written projectLineItems table). One org-wide line-item
 * fetch replaces the old per-supplier Prisma `projectLineItem.count`.
 */
async function getOrgSupplierCounts(
  organizationId: string,
): Promise<Map<string, { assets: number; orders: number; lineItems: number }>> {
  const [allAssets, allOrders, allLineItems] = await Promise.all([
    getAssetsByOrg(organizationId),
    (await getConvexClient()).query(api.supplierOrders.list, { orgId: organizationId }),
    getLineItemsByOrg(organizationId),
  ]);
  const lineItemCounts = countLineItemsBySupplierMap(allLineItems);
  const counts = new Map<string, { assets: number; orders: number; lineItems: number }>();
  const bump = (id: string) => {
    let c = counts.get(id);
    if (!c) counts.set(id, (c = { assets: 0, orders: 0, lineItems: 0 }));
    return c;
  };
  for (const a of allAssets) if (a.supplierId) bump(a.supplierId).assets++;
  for (const o of allOrders) if (o.supplierId) bump(o.supplierId).orders++;
  for (const [supplierId, n] of lineItemCounts) bump(supplierId).lineItems = n;
  return counts;
}

export async function getSuppliers() {
  const { organizationId } = await getOrgContext();
  const [suppliers, counts] = await Promise.all([
    getMappedSuppliersByOrg(organizationId),
    getOrgSupplierCounts(organizationId),
  ]);
  const active = suppliers
    .filter((s) => s.isActive)
    .sort(compareSuppliers("name", "asc"))
    .map((s) => ({
      ...s,
      _count: {
        assets: counts.get(s.id)?.assets ?? 0,
        orders: counts.get(s.id)?.orders ?? 0,
      },
    }));
  return serialize(active);
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

  const [all, counts] = await Promise.all([
    getMappedSuppliersByOrg(organizationId),
    getOrgSupplierCounts(organizationId),
  ]);

  // Replicates the old Prisma `where`: the `isActive` enum filter + the
  // case-insensitive search OR across name/contact/email/account#/tags.
  const activeFilter = filters?.isActive as string | undefined;
  const filtered = all.filter((s) => {
    if (activeFilter === "true" && s.isActive !== true) return false;
    if (activeFilter === "false" && s.isActive !== false) return false;
    return search ? supplierMatchesSearch(s, search) : true;
  });

  const total = filtered.length;
  const sorted = filtered.sort(compareSuppliers(sortBy, sortOrder));
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize);

  // assets/orders/lineItems all come from the Convex counts map now.
  const suppliers = pageItems.map((s) => ({
    ...s,
    _count: {
      assets: counts.get(s.id)?.assets ?? 0,
      orders: counts.get(s.id)?.orders ?? 0,
      lineItems: counts.get(s.id)?.lineItems ?? 0,
    },
  }));

  return serialize({ suppliers, total });
}

/**
 * Asset + order counts per supplier (supplierId -> { assets, orders }).
 * Both inputs now come off Convex — assets via getAssetsByOrg and supplier orders
 * via getSupplierOrdersByOrg (both dual-written) — counted in JS by
 * countSupplierAssetsAndOrders, replacing the Prisma `supplierOrder.groupBy`
 * (Phase A). Used by the reactive supplier table, which subscribes to the supplier
 * list via Convex and merges these (non-reactive) counts.
 */
export async function getSupplierCounts(): Promise<Record<string, { assets: number; orders: number }>> {
  const { organizationId } = await getOrgContext();
  const [allAssets, orders] = await Promise.all([
    getAssetsByOrg(organizationId),
    getSupplierOrdersByOrg(organizationId),
  ]);
  return serialize(countSupplierAssetsAndOrders(allAssets, orders));
}

export async function getSupplierById(id: string) {
  const { organizationId } = await getOrgContext();
  const doc = await getConvexSupplierById(id);
  if (!doc || doc.organizationId !== organizationId) throw new Error("Supplier not found");

  // assets/orders/lineItems counts all from Convex now.
  // The embedded `orders` array the old shape carried is dropped — the detail page
  // fetches its order list via getSupplierOrders, never reads `supplier.orders`.
  const counts = await getOrgSupplierCounts(organizationId);

  return serialize({
    ...mapSupplier(doc),
    _count: {
      assets: counts.get(id)?.assets ?? 0,
      orders: counts.get(id)?.orders ?? 0,
      lineItems: counts.get(id)?.lineItems ?? 0,
    },
  });
}

export async function getSupplierAssets(supplierId: string, params: {
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { page = 1, pageSize = 25 } = params;

  const allOrgAssets = await getAssetsByOrg(organizationId);
  const filtered = allOrgAssets
    .filter((a) => a.supplierId === supplierId && a.isActive !== false)
    .sort((a, b) => a.assetTag.localeCompare(b.assetTag));
  const total = filtered.length;
  const rawAssets = filtered.slice((page - 1) * pageSize, page * pageSize);

  const assets = await attachModel(organizationId, rawAssets);
  return serialize({ assets, total });
}

export async function getSupplierSubhires(supplierId: string, params: {
  page?: number;
  pageSize?: number;
}) {
  const { organizationId } = await getOrgContext();
  const { page = 1, pageSize = 25 } = params;

  // Sub-hire line items now identified by `subHireId != null` (Wave 2). Read from
  // the dual-written Convex line items; the per-line `project` select is grafted
  // from the Convex project list (a missing project → null, no Prisma fallback).
  const [allLineItems, allProjects] = await Promise.all([
    getLineItemsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const projectById = new Map<string, SubhireProjectSelect>(
    allProjects.map((p) => [
      p.id,
      { id: p.id, name: p.name, projectNumber: p.projectNumber ?? null, status: p.status ?? "" },
    ]),
  );
  const { items: rawLineItems, total } = buildSupplierSubhires(
    allLineItems,
    supplierId,
    projectById,
    page,
    pageSize,
  );

  const lineItems = await attachModel(organizationId, rawLineItems);
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
  // Explicit cuid so the Prisma row and the Convex doc share one id.
  const id = createId();
  const result = await prisma.supplier.create({
    data: { ...cleaned, id, organizationId },
  });
  await mirrorSupplierToConvex(result);

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
  await patchSupplierInConvex(id, updated);

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
  await (await getConvexClient()).mutation(api.suppliers.remove, { id });

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
