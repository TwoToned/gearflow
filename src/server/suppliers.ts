"use server";

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
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
  type MappedSupplier,
} from "@/lib/suppliers-read";

// Suppliers are CONVEX-ONLY (Phase B write inversion): every create/update/delete
// writes the Convex `suppliers` doc as the sole source of truth — no Prisma row,
// no mirror. The inbound FKs into the frozen Prisma `supplier` table
// (asset/project_line_item/supplier_order/sub_hire/supplier_model_rate
// .supplierId) were dropped (see migration
// 20260617131100_drop_supplier_fk_constraints), so each `supplierId` is now a
// plain string holding the Convex cuid.
//
// Invariants re-implemented in app code (Convex has no constraints/cascades):
//  - Delete guard: deleteSupplier blocks deletion while the supplier has assets,
//    line items, or orders (counts computed from Convex via getOrgSupplierCounts).
//    Because the guard blocks whenever any of those exist, the supplier->order/
//    item/rate Cascade the dropped FKs carried never fired in practice — so no
//    full cascade re-impl is needed.
//  - supplier_model_rate cleanup: rates are NOT covered by the delete guard (a
//    supplier with only rates CAN be deleted), and they used to cascade-delete.
//    deleteSupplier re-implements that one: after the guards pass it deletes the
//    supplier's supplier_model_rate rows from BOTH stores (still dual-written —
//    Prisma deleteMany + Convex remove each).
//  - Org-guard: reads the target via getConvexSupplierById and verifies
//    organizationId before any update/remove.
//
// `isActive`/tags/etc pass through unchanged. logActivity + buildChanges retained.
// The `before` diff for the update activity log reads the prior Convex doc.
// See FEATUREDOCS/54 + docs/designs/convex-decommission-RUNBOOK.md.

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
  const tags = (parsed.tags || []).map((t: string) => t.toLowerCase());
  const id = createId();
  const now = Date.now();

  // Convex `db.patch`/insert can't store a null scalar — pass `undefined` for
  // empty optionals; the read mapper coerces absent -> null, matching the old
  // Prisma `field || null` shape.
  await (await getConvexClient()).mutation(api.suppliers.create, {
    id,
    organizationId,
    name: parsed.name,
    contactName: parsed.contactName || undefined,
    email: parsed.email || undefined,
    phone: parsed.phone || undefined,
    website: parsed.website || undefined,
    address: parsed.address || undefined,
    latitude: parsed.latitude ?? undefined,
    longitude: parsed.longitude ?? undefined,
    notes: parsed.notes || undefined,
    accountNumber: parsed.accountNumber || undefined,
    paymentTerms: parsed.paymentTerms || undefined,
    defaultLeadTime: parsed.defaultLeadTime || undefined,
    tags,
    isActive: parsed.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "supplier",
    entityId: id,
    entityName: parsed.name,
    summary: `Created supplier ${parsed.name}`,
  });

  // Return the same serialized Prisma-row shape consumers expect (a brand-new
  // supplier has zero dependents).
  return serialize({
    id,
    organizationId,
    name: parsed.name,
    contactName: parsed.contactName || null,
    email: parsed.email || null,
    phone: parsed.phone || null,
    website: parsed.website || null,
    address: parsed.address || null,
    latitude: parsed.latitude ?? null,
    longitude: parsed.longitude ?? null,
    notes: parsed.notes || null,
    accountNumber: parsed.accountNumber || null,
    paymentTerms: parsed.paymentTerms || null,
    defaultLeadTime: parsed.defaultLeadTime || null,
    tags,
    isActive: parsed.isActive ?? true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
}

export async function updateSupplier(id: string, data: SupplierFormValues) {
  const { organizationId, userId, userName } = await requirePermission("supplier", "update");
  const parsed = supplierSchema.parse(data);

  // Org-guard + change-diff source: read the prior Convex doc (mapped to the
  // Prisma-row shape so buildChanges compares like-for-like).
  const beforeDoc = await getConvexSupplierById(id);
  if (!beforeDoc || beforeDoc.organizationId !== organizationId) {
    throw new Error("Supplier not found");
  }
  const before = mapSupplier(beforeDoc);

  const tags = (parsed.tags || []).map((t: string) => t.toLowerCase());

  // Mirror the prior cleaned-row shape (empty -> null) for the activity-log diff
  // and the returned shape.
  const updated: MappedSupplier = {
    id,
    organizationId,
    name: parsed.name,
    contactName: parsed.contactName || null,
    email: parsed.email || null,
    phone: parsed.phone || null,
    website: parsed.website || null,
    address: parsed.address || null,
    latitude: parsed.latitude ?? null,
    longitude: parsed.longitude ?? null,
    notes: parsed.notes || null,
    accountNumber: parsed.accountNumber || null,
    paymentTerms: parsed.paymentTerms || null,
    defaultLeadTime: parsed.defaultLeadTime || null,
    tags,
    isActive: parsed.isActive ?? true,
    createdAt: before.createdAt,
    updatedAt: new Date(),
  };

  // Convex patch can't set a field to null; pass `undefined` to clear an optional
  // (Convex `db.patch` treats undefined as field removal; the read mapper coerces
  // absent -> null, matching the old Prisma `field || null`).
  await (await getConvexClient()).mutation(api.suppliers.update, {
    id,
    patch: {
      name: parsed.name,
      contactName: parsed.contactName || undefined,
      email: parsed.email || undefined,
      phone: parsed.phone || undefined,
      website: parsed.website || undefined,
      address: parsed.address || undefined,
      latitude: parsed.latitude ?? undefined,
      longitude: parsed.longitude ?? undefined,
      notes: parsed.notes || undefined,
      accountNumber: parsed.accountNumber || undefined,
      paymentTerms: parsed.paymentTerms || undefined,
      defaultLeadTime: parsed.defaultLeadTime || undefined,
      tags,
      isActive: parsed.isActive ?? true,
      updatedAt: updated.updatedAt.getTime(),
    },
  });

  const changes = buildChanges(
    before as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>,
    [
      "name", "contactName", "email", "phone", "website", "address",
      "notes", "accountNumber", "paymentTerms", "defaultLeadTime", "isActive",
    ],
  );

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

  // Org-guard via the Convex doc (replaces the old Prisma findUnique).
  const supplier = await getConvexSupplierById(id);
  if (!supplier || supplier.organizationId !== organizationId) {
    throw new Error("Supplier not found");
  }

  // Delete guard — re-implemented from Convex counts (the dropped FKs' Cascade
  // never fired because this guard blocks deletion whenever dependents exist).
  // Same messages + order as the old Prisma `_count` guard.
  const counts = (await getOrgSupplierCounts(organizationId)).get(id);
  if ((counts?.assets ?? 0) > 0) {
    throw new Error("Cannot delete supplier with linked assets");
  }
  if ((counts?.lineItems ?? 0) > 0) {
    throw new Error("Cannot delete supplier with linked line items");
  }
  if ((counts?.orders ?? 0) > 0) {
    throw new Error("Cannot delete supplier with existing orders. Archive it instead.");
  }

  // supplier_model_rate is Convex-only (Phase B). Delete from Convex directly.
  const convex = await getConvexClient();
  const orgRates = await convex.query(api.supplierModelRates.list, { orgId: organizationId });
  const supplierRateIds = orgRates.filter((r) => r.supplierId === id).map((r) => r.id);
  for (const rateId of supplierRateIds) {
    await convex.mutation(api.supplierModelRates.remove, { id: rateId });
  }

  await convex.mutation(api.suppliers.remove, { id });

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
