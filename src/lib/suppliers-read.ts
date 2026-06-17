import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Suppliers domain (Phase 3 cutover).
 *
 * Suppliers are dual-written: every create/update/delete in the server actions
 * writes BOTH the Prisma `supplier` row (the durable FK anchor — `asset`,
 * `bulk_asset`, `project_line_item`, `sub_hire`, `supplier_order`, and
 * `supplier_model_rate` all carry a real FK to it, two of them required +
 * Cascade) AND the Convex `suppliers` doc (the reactive read source the browser
 * subscribes to). Reads that want reactivity — the supplier list, the supplier
 * dropdowns, the edit form — go through Convex via this helper / the
 * `use-suppliers` hooks. Cross-domain joins that only render `supplier.name`
 * deep inside warehouse / category / PDF pipelines stay on the (dual-write-fresh)
 * Prisma mirror for now; migrating those to Convex attach is deferred to the
 * Prisma-decommission phase. See FEATUREDOCS/54.
 *
 * The Convex supplier doc carries the same business fields as the Prisma row
 * (name, contact*, address, lat/long, tags, notes, accountNumber, paymentTerms,
 * defaultLeadTime, isActive) plus the preserved cuid `id` and numeric
 * `createdAt`/`updatedAt`.
 */
export type ConvexSupplier = Doc<"suppliers">;

export async function getSupplierById(id: string): Promise<ConvexSupplier | null> {
  return await (await getConvexClient()).query(api.suppliers.getById, { id });
}

export async function getSuppliersByOrg(orgId: string): Promise<ConvexSupplier[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.suppliers.list, { orgId }),
  );
}

/** All of an org's suppliers keyed by cuid `id`, for attaching to joined rows. */
export async function getSupplierMap(orgId: string): Promise<Map<string, ConvexSupplier>> {
  const all = await getSuppliersByOrg(orgId);
  return new Map(all.map((s) => [s.id, s]));
}

/**
 * Attach a `supplier` field to rows that carry a `supplierId`, replacing a Prisma
 * `include: { supplier }`. One Convex round-trip per call (the org supplier map).
 */
export async function attachSupplier<T extends { supplierId: string | null }>(
  orgId: string,
  rows: T[],
): Promise<Array<T & { supplier: ConvexSupplier | null }>> {
  if (rows.length === 0) return [];
  const map = await getSupplierMap(orgId);
  return rows.map((r) => ({
    ...r,
    supplier: r.supplierId ? map.get(r.supplierId) ?? null : null,
  }));
}

/**
 * cuids of the org's suppliers whose `name` matches `term` (case-insensitive
 * substring), for converting a Prisma `where: { supplier: { name: { contains } } }`
 * filter to a `supplierId: { in: [...] }` predicate now that the join lives in
 * Convex. Returns `[]` on no match — callers MUST omit the `supplierId in`
 * branch entirely rather than emit `in: []` (which would match nothing in an OR
 * and is a footgun in an AND). Matches Prisma's `mode: "insensitive"` for the
 * ASCII supplier names this app uses. Only safe when the query does NOT sort or
 * paginate by the joined supplier name (it can't, post-join-removal).
 */
export async function getMatchingSupplierIds(orgId: string, term: string): Promise<string[]> {
  const needle = term.toLowerCase();
  const all = await getSuppliersByOrg(orgId);
  return all.filter((s) => s.name.toLowerCase().includes(needle)).map((s) => s.id);
}

export type ConvexSupplierOrder = Doc<"supplierOrders">;

/** All of an org's supplier orders (supplier_order), for per-supplier counts. */
export async function getSupplierOrdersByOrg(orgId: string): Promise<ConvexSupplierOrder[]> {
  return await (await getConvexClient()).query(api.supplierOrders.list, { orgId });
}

/**
 * Per-supplier asset + order counts (supplierId -> { assets, orders }) computed in
 * JS over the org's assets + supplier orders, replacing the Prisma
 * `supplierOrder.groupBy({ by: ["supplierId"] })` in `getSupplierCounts`. A
 * `null`/absent `supplierId` is skipped (matches the Prisma loops, which only
 * count rows carrying a supplierId). Pure + unit-tested.
 */
export function countSupplierAssetsAndOrders(
  assets: Array<{ supplierId?: string | null }>,
  orders: Array<{ supplierId?: string | null }>,
): Record<string, { assets: number; orders: number }> {
  const counts: Record<string, { assets: number; orders: number }> = {};
  const ensure = (id: string) => (counts[id] ??= { assets: 0, orders: 0 });
  for (const a of assets) if (a.supplierId) ensure(a.supplierId).assets++;
  for (const o of orders) if (o.supplierId) ensure(o.supplierId).orders++;
  return counts;
}
