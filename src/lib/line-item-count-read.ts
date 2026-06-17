import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { mapLineItemDoc, type MappedLineItem } from "@/lib/project-line-item-read";

/**
 * Convex read layer for **project line-item COUNTS / flags** — the cross-domain
 * scalar counts and the issue-flag line-item inputs that were "keystone-blocked"
 * while the line-item tree itself was on Prisma. The tree reconstruction now lives
 * in `project-line-item-read.ts`; this module covers the leaf reads that only need
 * to count / filter the flat `projectLineItems` rows, NOT the nested kit/unit tree.
 *
 * Everything here is computed in JS over the dual-written Convex `projectLineItems`
 * table (fetched via `projectLineItems.list({orgId})` or `listByProjectIds`),
 * replicating the original Prisma `where` clauses EXACTLY:
 *   - `type === "EQUIPMENT"` where the Prisma `where` filtered on it
 *   - `status !== "CANCELLED"` where the Prisma `where` had `status: { not: "CANCELLED" }`
 *   - `status === "CHECKED_OUT"` for the overdue-return count
 *   - `supplierId === X` for the per-supplier counts
 *   - `subHireId != null` for sub-hire items
 *
 * The pure functions (suffix `*Count` / `*ByProject`) take an already-fetched
 * `MappedLineItem[]` so they're unit-testable without I/O. No Prisma fallback on a
 * Convex miss — a missing row reads as "not counted", same as a Prisma join against
 * a deleted row.
 */

/** Fetch ALL of an org's line items (raw Convex docs → mapped Prisma-shape rows). */
export async function getLineItemsByOrg(orgId: string): Promise<MappedLineItem[]> {
  const docs = await (await getConvexClient()).query(api.projectLineItems.list, { orgId });
  return docs.map(mapLineItemDoc);
}

/** Fetch the line items for a fixed set of projects (single round trip). */
export async function getLineItemsByProjectIds(
  orgId: string,
  projectIds: string[],
): Promise<MappedLineItem[]> {
  if (projectIds.length === 0) return [];
  const docs = await (await getConvexClient()).query(api.projectLineItems.listByProjectIds, {
    orgId,
    projectIds,
  });
  return docs.map(mapLineItemDoc);
}

/* ------------------------------------------------------------------------- *
 * Pure count / group functions (unit-tested)
 * ------------------------------------------------------------------------- */

/**
 * Per-project count of `type === "EQUIPMENT"` line items, restricted to a set of
 * project ids. Replaces dashboard / client groupBy:
 *   `groupBy(by: projectId, where: { organizationId, projectId in ids, type: EQUIPMENT })`
 * Returns a Map keyed by projectId. Items outside `projectIds` are ignored.
 */
export function countEquipmentLineItemsByProject(
  lineItems: MappedLineItem[],
  projectIds: string[],
): Map<string, number> {
  const wanted = new Set(projectIds);
  const map = new Map<string, number>();
  for (const li of lineItems) {
    if (li.type !== "EQUIPMENT") continue;
    if (!wanted.has(li.projectId)) continue;
    map.set(li.projectId, (map.get(li.projectId) ?? 0) + 1);
  }
  return map;
}

/**
 * Per-project count of ALL line items (no `type` filter), restricted to a set of
 * project ids. Replaces the client-detail groupBy:
 *   `groupBy(by: projectId, where: { organizationId, project: { clientId } })`
 * The Prisma read scoped by the project's client relation; the caller already
 * holds the client's project ids, so we count over those.
 */
export function countAllLineItemsByProject(
  lineItems: MappedLineItem[],
  projectIds: string[],
): Map<string, number> {
  const wanted = new Set(projectIds);
  const map = new Map<string, number>();
  for (const li of lineItems) {
    if (!wanted.has(li.projectId)) continue;
    map.set(li.projectId, (map.get(li.projectId) ?? 0) + 1);
  }
  return map;
}

/**
 * Count of CHECKED_OUT line items belonging to one of a set of "overdue" project
 * ids. Replaces the dashboard overdue-returns count:
 *   `count(where: { status: CHECKED_OUT, project: { isTemplate:false, rentalEndDate < now, status notIn [...] } })`
 * The caller resolves the overdue project-id set (from the Convex project list);
 * this just counts CHECKED_OUT items in those projects.
 */
export function countCheckedOutInProjects(
  lineItems: MappedLineItem[],
  overdueProjectIds: Set<string>,
): number {
  let n = 0;
  for (const li of lineItems) {
    if (li.status !== "CHECKED_OUT") continue;
    if (!overdueProjectIds.has(li.projectId)) continue;
    n++;
  }
  return n;
}

/**
 * Per-project count of TOP-LEVEL (non kit-child) line items, restricted to a set
 * of project ids. Replaces the templates `_count`:
 *   `_count: { lineItems: { where: { isKitChild: false } } }`
 * Returns a Map keyed by projectId.
 */
export function countTopLevelLineItemsByProject(
  lineItems: MappedLineItem[],
  projectIds: string[],
): Map<string, number> {
  const wanted = new Set(projectIds);
  const map = new Map<string, number>();
  for (const li of lineItems) {
    if (li.isKitChild) continue;
    if (!wanted.has(li.projectId)) continue;
    map.set(li.projectId, (map.get(li.projectId) ?? 0) + 1);
  }
  return map;
}

/** Count of a supplier's line items (any status/type). Replaces
 *  `projectLineItem.count({ where: { organizationId, supplierId } })`. */
export function countLineItemsBySupplier(
  lineItems: MappedLineItem[],
  supplierId: string,
): number {
  let n = 0;
  for (const li of lineItems) if (li.supplierId === supplierId) n++;
  return n;
}

/** Per-supplier line-item counts for a whole org (supplierId → count). One pass. */
export function countLineItemsBySupplierMap(lineItems: MappedLineItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const li of lineItems) {
    if (!li.supplierId) continue;
    map.set(li.supplierId, (map.get(li.supplierId) ?? 0) + 1);
  }
  return map;
}

/**
 * The active-project line-item inputs for `getProjectIssueFlags`, grouped per
 * project. Replaces:
 *   `findMany(where: { organizationId, projectId in activeIds, status != CANCELLED },
 *             select: { id, projectId, modelId, quantity, isKitChild, parentLineItemId, kitId, status })`
 * Returns a Map projectId → the items (status != CANCELLED) for that project.
 * The shape matches `computeOverbookedStatus`'s `lineItems` parameter (it reads
 * id/modelId/quantity/isKitChild/parentLineItemId/kitId/status/subHireId).
 */
export function groupActiveLineItemsByProject(
  lineItems: MappedLineItem[],
  activeProjectIds: string[],
): Map<string, MappedLineItem[]> {
  const wanted = new Set(activeProjectIds);
  const map = new Map<string, MappedLineItem[]>();
  for (const li of lineItems) {
    if (li.status === "CANCELLED") continue;
    if (!wanted.has(li.projectId)) continue;
    let arr = map.get(li.projectId);
    if (!arr) map.set(li.projectId, (arr = []));
    arr.push(li);
  }
  return map;
}

/* ------------------------------------------------------------------------- *
 * getProjects(includeLineItems) — the per-project line-item slim list
 * ------------------------------------------------------------------------- */

/** The slim line-item shape `getProjects({ includeLineItems })` selected:
 *  `{ id, status, type, isKitChild }`, scoped to status != CANCELLED && type === EQUIPMENT. */
export interface SlimLineItem {
  id: string;
  status: string;
  type: string;
  isKitChild: boolean;
}

/**
 * Build the per-project `lineItems` arrays for `getProjects({ includeLineItems })`.
 * Replicates the Prisma include:
 *   `lineItems: { where: { status: { not: CANCELLED }, type: EQUIPMENT },
 *                 select: { id, status, type, isKitChild } }`
 * Returns a Map projectId → slim line items (only for the requested project ids).
 */
export function buildIncludeLineItemsByProject(
  lineItems: MappedLineItem[],
  projectIds: string[],
): Map<string, SlimLineItem[]> {
  const wanted = new Set(projectIds);
  const map = new Map<string, SlimLineItem[]>();
  for (const li of lineItems) {
    if (li.status === "CANCELLED") continue;
    if (li.type !== "EQUIPMENT") continue;
    if (!wanted.has(li.projectId)) continue;
    let arr = map.get(li.projectId);
    if (!arr) map.set(li.projectId, (arr = []));
    arr.push({ id: li.id, status: li.status, type: li.type, isKitChild: li.isKitChild });
  }
  return map;
}

/* ------------------------------------------------------------------------- *
 * getSupplierSubhires — sub-hire line items for a supplier, paginated
 * ------------------------------------------------------------------------- */

/** The per-line `project` select getSupplierSubhires's Prisma include carried. */
export interface SubhireProjectSelect {
  id: string;
  name: string;
  projectNumber: string | null;
  status: string;
}

/**
 * A supplier's sub-hire line items, newest first, paginated — replicating:
 *   `findMany(where: { organizationId, supplierId, subHireId: { not: null } },
 *             include: { project: select { id, name, projectNumber, status } },
 *             orderBy: { createdAt: desc }, skip, take)`
 * plus the matching `count`. `projectById` resolves the project select from the
 * already-Convex project list (a missing project → `null`, no Prisma fallback).
 * Returns the page of items (each with `project` grafted) + the total count.
 */
export function buildSupplierSubhires(
  lineItems: MappedLineItem[],
  supplierId: string,
  projectById: Map<string, SubhireProjectSelect>,
  page: number,
  pageSize: number,
): { items: Array<MappedLineItem & { project: SubhireProjectSelect | null }>; total: number } {
  const matching = lineItems
    .filter((li) => li.supplierId === supplierId && li.subHireId != null)
    .sort((a, b) => {
      // orderBy createdAt desc; null createdAt sorts last (Prisma nulls-last on desc).
      const at = a.createdAt ? a.createdAt.getTime() : -Infinity;
      const bt = b.createdAt ? b.createdAt.getTime() : -Infinity;
      return bt - at;
    });
  const total = matching.length;
  const pageItems = matching.slice((page - 1) * pageSize, page * pageSize).map((li) => ({
    ...li,
    project: projectById.get(li.projectId) ?? null,
  }));
  return { items: pageItems, total };
}
