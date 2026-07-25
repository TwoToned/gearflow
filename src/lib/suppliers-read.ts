import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Suppliers domain (Phase 3 cutover).
 *
 * Suppliers are Convex-only: `prisma/schema.prisma` has no `supplier` model, and
 * there are no `prisma.supplier.*` writes anywhere in `src/` — the Convex
 * `suppliers` doc is the sole store, and every FK relationship (`asset`,
 * `bulk_asset`, `project_line_item`, `sub_hire`, `supplier_order`,
 * `supplier_model_rate`) resolves against the Convex `id`, not a Postgres row. All
 * reads — the supplier list, the supplier dropdowns, the edit form, and the
 * cross-domain joins that render `supplier.name` inside warehouse / category / PDF
 * pipelines — go through Convex via this helper / the `use-suppliers` hooks.
 * See FEATUREDOCS/54.
 *
 * The Convex supplier doc carries the same business fields the old Prisma row used
 * to (name, contact*, address, lat/long, tags, notes, accountNumber, paymentTerms,
 * defaultLeadTime, isActive) plus the preserved cuid `id` and numeric
 * `createdAt`/`updatedAt`.
 */
export type ConvexSupplier = Doc<"suppliers">;

/**
 * A Convex supplier doc mapped back to the *Prisma-row shape* the server actions
 * (`getSuppliers` / `getSuppliersPaginated` / `getSupplierById`) used to return:
 * `createdAt`/`updatedAt` as `Date` (because `serialize` preserves `Date`, so the
 * client receives the same shape it always has), Prisma-defaulted columns coerced
 * non-null (`tags: []`, `isActive: true`), and absent optionals as `null`. The
 * Convex system fields (`_id`/`_creationTime`) are stripped.
 */
export type MappedSupplier = Omit<
  ConvexSupplier,
  | "_id"
  | "_creationTime"
  | "contactName"
  | "email"
  | "phone"
  | "website"
  | "address"
  | "latitude"
  | "longitude"
  | "notes"
  | "accountNumber"
  | "paymentTerms"
  | "defaultLeadTime"
  | "tags"
  | "isActive"
  | "createdAt"
  | "updatedAt"
> & {
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  accountNumber: string | null;
  paymentTerms: string | null;
  defaultLeadTime: string | null;
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Map a raw Convex supplier doc back to the Prisma-row shape (see MappedSupplier). */
export function mapSupplier(doc: ConvexSupplier): MappedSupplier {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    name: doc.name,
    contactName: doc.contactName ?? null,
    email: doc.email ?? null,
    phone: doc.phone ?? null,
    website: doc.website ?? null,
    address: doc.address ?? null,
    latitude: doc.latitude ?? null,
    longitude: doc.longitude ?? null,
    notes: doc.notes ?? null,
    accountNumber: doc.accountNumber ?? null,
    paymentTerms: doc.paymentTerms ?? null,
    defaultLeadTime: doc.defaultLeadTime ?? null,
    tags: doc.tags ?? [],
    isActive: doc.isActive ?? true,
    createdAt: new Date(doc.createdAt ?? 0),
    updatedAt: new Date(doc.updatedAt ?? 0),
  };
}

export async function getSupplierById(id: string): Promise<ConvexSupplier | null> {
  return await (await getConvexClient()).query(api.suppliers.getById, { id });
}

/** All of an org's suppliers, mapped to the Prisma-row shape (Date/null/defaults). */
export async function getMappedSuppliersByOrg(orgId: string): Promise<MappedSupplier[]> {
  return (await getSuppliersByOrg(orgId)).map(mapSupplier);
}

/**
 * Pure predicate replicating the old `getSuppliersPaginated` Prisma `where`:
 * the case-insensitive `search` OR across name/contactName/email/accountNumber
 * (+ `tags hasSome [search.toLowerCase()]`). `organizationId` and the `isActive`
 * enum filter are applied separately by the caller (they map to dedicated
 * narrowings). An empty/blank `search` matches everything.
 */
export function supplierMatchesSearch(s: MappedSupplier, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    s.name.toLowerCase().includes(q) ||
    (s.contactName?.toLowerCase().includes(q) ?? false) ||
    (s.email?.toLowerCase().includes(q) ?? false) ||
    (s.accountNumber?.toLowerCase().includes(q) ?? false) ||
    s.tags.includes(q)
  );
}

/**
 * Comparator replicating Prisma `orderBy: { [sortBy]: sortOrder }` for the supplier
 * columns the table sorts by (string fields like `name`, plus the `Date`/`boolean`
 * columns). Nulls sort LAST regardless of direction, matching Postgres' default
 * `NULLS LAST` for ascending and replicating it for descending too (the supplier
 * table never sorts on a nullable column, but we keep the rule explicit). Strings
 * use locale-aware, case-insensitive comparison (Prisma `name` ordering is
 * collation-driven; this matches the ASCII supplier names this app uses).
 */
export function compareSuppliers(
  sortBy: string,
  sortOrder: "asc" | "desc",
): (a: MappedSupplier, b: MappedSupplier) => number {
  const dir = sortOrder === "desc" ? -1 : 1;
  return (a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortBy];
    const bv = (b as unknown as Record<string, unknown>)[sortBy];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * dir;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    if (typeof av === "boolean" && typeof bv === "boolean") {
      return (Number(av) - Number(bv)) * dir;
    }
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
  };
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
