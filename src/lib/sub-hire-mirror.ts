import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * Sub-hire + supplier-order families — `sub_hire` (+ `sub_hire_item`,
 * `sub_hire_group`) and `supplier_order` (+ `supplier_order_item`) — are
 * DUAL-WRITTEN **infra-only**: no Phase 4. Sub-hires/orders are composed only
 * inside the cross-domain equipment editor + supplier detail/PDF views, which
 * stay on Prisma reads. See FEATUREDOCS/54.
 *
 * Dual-write: each family head carries required+Cascade inbound FKs from its
 * sub-tables (sub_hire ← item/group/media; supplier_order ← item), and
 * project_line_item / category_slot carry nullable refs across the boundary.
 *
 * SCOPE: sub_hire / sub_hire_item / sub_hire_group / supplier_order /
 * supplier_order_item. `sub_hire_media` stays Prisma-only (the *_media pattern —
 * composed on the mirror). The grouping↔line-item writes these flows also perform
 * are mirrored via the project-grouping / line-item mirrors.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent) — tolerable for a
 * consumer-less mirror; heals on a backfill run.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, toConvexDoc(row) as any);
}

async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(row);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, { id, patch: rest } as any);
}

async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getConvexClient().mutation(fn, { id } as any);
}

// Strip nested relations a family read may include before mirroring (scalar-only
// Convex validators reject extra fields).
const RELATION_KEYS = new Set([
  "subHire", "items", "groups", "media", "project", "supplier", "supplierOrder",
  "lineItems", "targetCategory", "targetGroup", "asset", "model", "order",
  "projectCategory", "projectGroup", "slot", "subHireItem", "subHireGroup",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

// ─── Sub-hire ────────────────────────────────────────────────────────────────
export const mirrorSubHireCreate = (row: Record<string, unknown>) => create(api.subHires.create, strip(row));
export const patchSubHireInConvex = (id: string, row: Record<string, unknown>) => patch(api.subHires.update, id, strip(row));
export const removeSubHireFromConvex = (id: string) => remove(api.subHires.remove, id);

// ─── Sub-hire items ────────────────────────────────────────────────────────────
export const mirrorSubHireItemCreate = (row: Record<string, unknown>) => create(api.subHireItems.create, strip(row));
export const patchSubHireItemInConvex = (id: string, row: Record<string, unknown>) => patch(api.subHireItems.update, id, strip(row));
export const removeSubHireItemFromConvex = (id: string) => remove(api.subHireItems.remove, id);

// ─── Sub-hire groups ────────────────────────────────────────────────────────────
export const mirrorSubHireGroupCreate = (row: Record<string, unknown>) => create(api.subHireGroups.create, strip(row));
export const patchSubHireGroupInConvex = (id: string, row: Record<string, unknown>) => patch(api.subHireGroups.update, id, strip(row));
export const removeSubHireGroupFromConvex = (id: string) => remove(api.subHireGroups.remove, id);

// ─── Supplier orders ────────────────────────────────────────────────────────────
export const mirrorSupplierOrderCreate = (row: Record<string, unknown>) => create(api.supplierOrders.create, strip(row));
export const patchSupplierOrderInConvex = (id: string, row: Record<string, unknown>) => patch(api.supplierOrders.update, id, strip(row));
export const removeSupplierOrderFromConvex = (id: string) => remove(api.supplierOrders.remove, id);

// ─── Supplier order items ────────────────────────────────────────────────────────
export const mirrorSupplierOrderItemCreate = (row: Record<string, unknown>) => create(api.supplierOrderItems.create, strip(row));
export const patchSupplierOrderItemInConvex = (id: string, row: Record<string, unknown>) => patch(api.supplierOrderItems.update, id, strip(row));
export const removeSupplierOrderItemFromConvex = (id: string) => remove(api.supplierOrderItems.remove, id);

/** Re-read a whole sub_hire (head + items + groups) from Prisma and upsert each
 *  into Convex. The workhorse for sub-hires.ts multi-row `$transaction`s. */
export async function syncSubHireToConvex(subHireId: string | null | undefined) {
  if (!subHireId) return;
  const sh = await prisma.subHire.findUnique({
    where: { id: subHireId },
    include: { items: true, groups: true },
  });
  if (!sh) return;
  const { items, groups, ...head } = sh;
  await upsert(api.subHires.getById, api.subHires.create, api.subHires.update, head as unknown as Record<string, unknown>);
  for (const it of items) await upsert(api.subHireItems.getById, api.subHireItems.create, api.subHireItems.update, it as unknown as Record<string, unknown>);
  for (const g of groups) await upsert(api.subHireGroups.getById, api.subHireGroups.create, api.subHireGroups.update, g as unknown as Record<string, unknown>);
}

/** Re-read a whole supplier_order (head + items) from Prisma and upsert each. */
export async function syncSupplierOrderToConvex(orderId: string | null | undefined) {
  if (!orderId) return;
  const order = await prisma.supplierOrder.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return;
  const { items, ...head } = order;
  await upsert(api.supplierOrders.getById, api.supplierOrders.create, api.supplierOrders.update, head as unknown as Record<string, unknown>);
  for (const it of items) await upsert(api.supplierOrderItems.getById, api.supplierOrderItems.create, api.supplierOrderItems.update, it as unknown as Record<string, unknown>);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsert(getRef: FunctionReference<"query", "public", any, any>, createRef: AnyRef, updateRef: AnyRef, row: Record<string, unknown>) {
  const id = row.id as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await getConvexClient().query(getRef, { id } as any);
  if (existing) await patch(updateRef, id, strip(row));
  else await create(createRef, strip(row));
}
