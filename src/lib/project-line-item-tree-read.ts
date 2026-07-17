/**
 * Pure reconstruction of the project equipment **line-item tree** from FLAT
 * Convex rows — the keystone of the Phase A read-rewiring (the shared reader behind
 * getProject / getProjectForWarehouse / getProjectPullSheet / build-document-data).
 *
 * Prisma produced the tree via nested `include`s off the `project → category →
 * group → lineItems → childLineItems → units` relations. These functions
 * reproduce the **exact same shape** from the flat dual-written Convex tables
 * (`projectLineItems` / `projectLineItemUnits` / `projectCategories` /
 * `projectGroups`), so the cross-domain attach helpers in `line-item-tree-read.ts`
 * (model/supplier/kit/asset/bulkAsset) and every downstream consumer keep working
 * unchanged.
 *
 * **Semantics learned from the Prisma queries (these are load-bearing):**
 * - A `lineItems` array is the *relation* for its scope, NOT just the parents:
 *   `project.lineItems` = ALL the project's non-CANCELLED items (parents AND
 *   children); `group.lineItems` = items WHERE `groupId === g.id`;
 *   `category.lineItems` = items WHERE `categoryId === c.id AND groupId == null`.
 *   A child therefore appears BOTH as a top-level array entry (if it matches the
 *   scope) AND nested under its parent's `childLineItems`. Consumers separate the
 *   two with `isKitChild` / `parentLineItemId` (e.g. structureLineItems,
 *   build-document-data `topLevelItems`). We reproduce this dual projection.
 * - `childLineItems` is matched by `parentLineItemId` regardless of scope,
 *   filtered `status != CANCELLED`, sorted `sortOrder asc`, to a fixed include
 *   DEPTH (getProject top-level = 2; grouped = 1; build-document-data per its
 *   own include). Past the included depth the `childLineItems` key is ABSENT
 *   (not `[]`), matching Prisma — so depth is explicit.
 * - `units` are filtered `status != CANCELLED`, sorted `ordinal asc`.
 *
 * These functions are PURE (no I/O) — the caller maps Convex docs → rows (dates →
 * Date, Decimal → number) and supplies the lookup maps; that keeps the tricky
 * reconstruction independently unit-testable with fixtures.
 */

/** Minimal structural contract every flat line-item row must satisfy. */
export interface FlatLineItem {
  id: string;
  parentLineItemId?: string | null;
  categoryId?: string | null;
  groupId?: string | null;
  status: string;
  sortOrder?: number | null;
}

/** Minimal structural contract for a flat unit row. */
export interface FlatUnit {
  id: string;
  lineItemId?: string | null;
  status?: string | null;
  ordinal?: number | null;
}

const notCancelled = (r: { status?: string | null }) => r.status !== "CANCELLED";
const bySortOrder = (a: { sortOrder?: number | null }, b: { sortOrder?: number | null }) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
const byOrdinal = (a: { ordinal?: number | null }, b: { ordinal?: number | null }) =>
  (a.ordinal ?? 0) - (b.ordinal ?? 0);

/**
 * Index non-CANCELLED line items by `parentLineItemId`, each bucket pre-sorted by
 * `sortOrder asc`. Built once per project; drives `childLineItems` reconstruction.
 */
export function indexChildren<T extends FlatLineItem>(
  rows: T[],
  keepCancelled = false,
): Map<string, T[]> {
  const byParent = new Map<string, T[]>();
  for (const r of rows) {
    if (!keepCancelled && !notCancelled(r)) continue;
    if (!r.parentLineItemId) continue;
    const arr = byParent.get(r.parentLineItemId);
    if (arr) arr.push(r);
    else byParent.set(r.parentLineItemId, [r]);
  }
  for (const arr of byParent.values()) arr.sort(bySortOrder);
  return byParent;
}

/** Index non-CANCELLED units by `lineItemId`, each bucket sorted by `ordinal asc`. */
export function indexUnits<U extends FlatUnit>(units: U[]): Map<string, U[]> {
  const byLineItem = new Map<string, U[]>();
  for (const u of units) {
    if (u.status === "CANCELLED") continue;
    if (!u.lineItemId) continue;
    const arr = byLineItem.get(u.lineItemId);
    if (arr) arr.push(u);
    else byLineItem.set(u.lineItemId, [u]);
  }
  for (const arr of byLineItem.values()) arr.sort(byOrdinal);
  return byLineItem;
}

export interface NestExtras<U> {
  /** Units attached per line item (already filtered + sorted). */
  unitsByLineItem: Map<string, U[]>;
  /** Max `childLineItems` recursion depth (Prisma include depth). Past it the key is omitted. */
  depth: number;
  /** Keep CANCELLED scope rows instead of dropping them. The getProject editor
   *  hides CANCELLED merge tombstones (default `false`); the warehouse reads
   *  include every status, so they pass `true`. Must match the `keepCancelled`
   *  passed to {@link indexChildren} so nested children behave the same. */
  keepCancelled?: boolean;
}

/**
 * Expand one row: attach its `units` and (while `depth > 0`) its `childLineItems`
 * (recursively, depth-1). At `depth === 0` the `childLineItems` key is omitted —
 * matching a Prisma include that stops there. Pure; returns a new object.
 */
function expand<T extends FlatLineItem, U>(
  row: T,
  byParent: Map<string, T[]>,
  extras: NestExtras<U>,
  depth: number,
): T & { units: U[]; childLineItems?: unknown } {
  const units = extras.unitsByLineItem.get(row.id) ?? [];
  if (depth <= 0) {
    return { ...row, units };
  }
  const kids = byParent.get(row.id) ?? [];
  return {
    ...row,
    units,
    childLineItems: kids.map((k) => expand(k, byParent, extras, depth - 1)),
  };
}

/**
 * Reconstruct the `lineItems` array for a scope: take the flat rows that belong to
 * the scope (already scope-filtered by the caller), drop CANCELLED (unless
 * `extras.keepCancelled`), sort by `sortOrder asc`, and expand each with units +
 * nested `childLineItems` to `depth`.
 * `childLineItems` are matched globally by `parentLineItemId` (via `byParent`),
 * NOT by scope — exactly like the Prisma relation include.
 */
export function reconstructScope<T extends FlatLineItem, U>(
  scopeRows: T[],
  byParent: Map<string, T[]>,
  extras: NestExtras<U>,
): Array<T & { units: U[]; childLineItems?: unknown }> {
  return scopeRows
    .filter((r) => (extras.keepCancelled ? true : notCancelled(r)))
    .sort(bySortOrder)
    .map((r) => expand(r, byParent, extras, extras.depth));
}

/**
 * Reconstruct the `project.categories[]` tree: for each category (sorted), build
 * its `groups[]` (sorted) — each with `lineItems` WHERE `groupId === group.id` —
 * and the category-direct `lineItems` WHERE `categoryId === category.id AND
 * groupId == null`. Group/category `lineItems` use `groupedDepth`. Mirrors
 * getProject's `categories` include.
 */
export function reconstructCategories<
  C extends { id: string; sortOrder?: number | null },
  G extends { id: string; categoryId?: string | null; sortOrder?: number | null },
  T extends FlatLineItem,
  U,
>(
  categories: C[],
  groups: G[],
  lineItems: T[],
  byParent: Map<string, T[]>,
  unitsByLineItem: Map<string, U[]>,
  groupedDepth: number,
): Array<C & { groups: Array<G & { lineItems: Array<T & { units: U[]; childLineItems?: unknown }> }>; lineItems: Array<T & { units: U[]; childLineItems?: unknown }> }> {
  const extras: NestExtras<U> = { unitsByLineItem, depth: groupedDepth };
  return [...categories].sort(bySortOrder).map((cat) => {
    const catGroups = groups
      .filter((g) => g.categoryId === cat.id)
      .sort(bySortOrder)
      .map((g) => ({
        ...g,
        lineItems: reconstructScope(lineItems.filter((li) => li.groupId === g.id), byParent, extras),
      }));
    const catLineItems = reconstructScope(
      lineItems.filter((li) => li.categoryId === cat.id && (li.groupId == null)),
      byParent,
      extras,
    );
    return { ...cat, groups: catGroups, lineItems: catLineItems };
  });
}
