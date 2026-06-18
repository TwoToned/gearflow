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
import {
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
 * Per-supplier `{ assets, orders }` counts for an org, both from Convex (assets via
 * the asset read helper, orders via the supplierOrders list). `projectLineItem`
 * stays in Prisma (keystone tree, not yet cut over), so `lineItems` is counted
 * separately by `getLineItemCount` when a consumer needs it.
 */
async function getOrgSupplierCounts(
  organizationId: string,
): Promise<Map<string, { assets: number; orders: number }>> {
  const [allAssets, allOrders] = await Promise.all([
    getAssetsByOrg(organizationId),
    (await getConvexClient()).query(api.supplierOrders.list, { orgId: organizationId }),
  ]);
  const counts = new Map<string, { assets: number; orders: number }>();
  const bump = (id: string) => {
    let c = counts.get(id);
    if (!c) counts.set(id, (c = { assets: 0, orders: 0 }));
    return c;
  };
  for (const a of allAssets) if (a.supplierId) bump(a.supplierId).assets++;
  for (const o of allOrders) if (o.supplierId) bump(o.supplierId).orders++;
  return counts;
}

/**
 * Count of sub-hire / supplier line items for a supplier. KEYSTONE-BLOCKED:
 * `projectLineItem` is the project line-item tree, which is read-rewired as a
 * single keystone unit later — until then this stays a Prisma count (a scalar
 * cross-domain count, NOT a tree read). Same rationale as `getSupplierSubhires`.
 */
async function getLineItemCount(organizationId: string, supplierId: string): Promise<number> {
  return prisma.projectLineItem.count({ where: { organizationId, supplierId } });
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

  // lineItems count is keystone-blocked (projectLineItem), so it's a per-page
  // Prisma count; assets/orders come from Convex.
  const lineItemCounts = await Promise.all(
    pageItems.map((s) => getLineItemCount(organizationId, s.id)),
  );
  const suppliers = pageItems.map((s, i) => ({
    ...s,
    _count: {
      assets: counts.get(s.id)?.assets ?? 0,
      orders: counts.get(s.id)?.orders ?? 0,
      lineItems: lineItemCounts[i],
    },
  }));

  return serialize({ suppliers, total });
}

/**
 * Asset + order counts per supplier (supplierId -> { assets, orders }).
 * Cross-domain: assets and supplier orders still live in Prisma, so this can't
 * come from Convex. Used by the reactive supplier table, which subscribes to the
 * supplier list via Convex and merges these (non-reactive) counts.
 */
export async function getSupplierCounts(): Promise<Record<string, { assets: number; orders: number }>> {
  const { organizationId } = await getOrgContext();
  const [allAssets, orderGroups] = await Promise.all([
    getAssetsByOrg(organizationId),
    prisma.supplierOrder.groupBy({
      by: ["supplierId"],
      where: { organizationId },
      _count: { _all: true },
    }),
  ]);
  const counts: Record<string, { assets: number; orders: number }> = {};
  for (const a of allAssets) {
    if (a.supplierId) (counts[a.supplierId] ??= { assets: 0, orders: 0 }).assets++;
  }
  for (const g of orderGroups) {
    if (g.supplierId) (counts[g.supplierId] ??= { assets: 0, orders: 0 }).orders = g._count._all;
  }
  return serialize(counts);
}

export async function getSupplierById(id: string) {
  const { organizationId } = await getOrgContext();
  const doc = await getConvexSupplierById(id);
  if (!doc || doc.organizationId !== organizationId) throw new Error("Supplier not found");

  // assets/orders counts from Convex; lineItems keystone-blocked (Prisma count).
  // The embedded `orders` array the old shape carried is dropped — the detail page
  // fetches its order list via getSupplierOrders, never reads `supplier.orders`.
  const [counts, lineItems] = await Promise.all([
    getOrgSupplierCounts(organizationId),
    getLineItemCount(organizationId, id),
  ]);

  return serialize({
    ...mapSupplier(doc),
    _count: {
      assets: counts.get(id)?.assets ?? 0,
      orders: counts.get(id)?.orders ?? 0,
      lineItems,
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

  // Sub-hire line items now identified by `subHireId != null` (Wave 2).
  const where = { organizationId, supplierId, subHireId: { not: null } };

  const [rawLineItems, total] = await Promise.all([
    prisma.projectLineItem.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, projectNumber: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.projectLineItem.count({ where }),
  ]);

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
