import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type {
  MaintenanceStatus,
  MaintenanceType,
  MaintenanceResult,
} from "@/generated/prisma/client";

/**
 * Server-side read helpers for the Maintenance domain (Phase A read-rewiring).
 *
 * `maintenanceRecord` is dual-written (Prisma FK anchor + Convex reactive doc —
 * see src/lib/maintenance-mirror.ts) and backfilled
 * (scripts/convex-backfill-maintenance.ts). The read-only server actions
 * `getMaintenanceRecords` / `getMaintenanceRecord` source the record row from
 * Convex via these helpers.
 *
 * The `maintenanceRecordAssets` join table is the intentional Prisma terminus —
 * it is NOT mirrored to Convex (the record's `updatedAt` bumps on any link
 * change, which is a sufficient reactive signal). So the asset/model join AND
 * the Auth-`User` joins (reportedBy / assignedTo) are attached from Prisma in
 * the server action, exactly as the old `include` did. This module only owns
 * the Convex record fetch + the Prisma→Convex shape mapping + the pure
 * filter/sort predicates replicating the old Prisma `where`/`orderBy`.
 *
 * No Prisma fallback on a Convex map miss (a miss reads as "absent", like a join
 * against a deleted row — falling back would hide mirror drift). See
 * FEATUREDOCS/54.
 */

type ConvexMaintenanceDoc = Doc<"maintenanceRecords">;

/**
 * A maintenance record in the Prisma-row shape the existing consumers expect:
 * Date fields are `Date` (Convex stores epoch-ms), `cost` is `number | null`,
 * Prisma-defaulted columns are coerced non-null, absent optionals are `null`.
 * Relations (assets / reportedBy / assignedTo) are attached separately from
 * Prisma in the server action.
 */
export interface MaintenanceRecordRow {
  id: string;
  organizationId: string;
  kitId: string | null;
  projectId: string | null;
  type: MaintenanceType;
  status: MaintenanceStatus;
  title: string;
  description: string | null;
  reportedById: string | null;
  assignedToId: string | null;
  scheduledDate: Date | null;
  completedDate: Date | null;
  cost: number | null;
  partsUsed: string | null;
  attachments: string[];
  photos: string[];
  result: MaintenanceResult | null;
  nextDueDate: Date | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** epoch-ms → Date, treating absent/null as null. */
function toDate(ms: number | null | undefined): Date | null {
  return ms === null || ms === undefined ? null : new Date(ms);
}

/**
 * Map a Convex `maintenanceRecords` doc to the Prisma-row shape. Strips
 * `_id`/`_creationTime`, converts epoch-ms→Date, coerces Prisma-defaulted
 * columns (`status` default SCHEDULED; `attachments`/`photos`/`tags` default
 * `[]`; `createdAt`/`updatedAt` are `@default(now())`/`@updatedAt` so always
 * present in practice but fall back to the doc's `_creationTime`), and
 * normalises absent optionals to `null`.
 */
export function mapMaintenanceRecord(doc: ConvexMaintenanceDoc): MaintenanceRecordRow {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    kitId: doc.kitId ?? null,
    projectId: doc.projectId ?? null,
    type: doc.type as MaintenanceType,
    status: (doc.status ?? "SCHEDULED") as MaintenanceStatus,
    title: doc.title,
    description: doc.description ?? null,
    reportedById: doc.reportedById ?? null,
    assignedToId: doc.assignedToId ?? null,
    scheduledDate: toDate(doc.scheduledDate),
    completedDate: toDate(doc.completedDate),
    cost: doc.cost ?? null,
    partsUsed: doc.partsUsed ?? null,
    attachments: doc.attachments ?? [],
    photos: doc.photos ?? [],
    result: (doc.result ?? null) as MaintenanceResult | null,
    nextDueDate: toDate(doc.nextDueDate),
    tags: doc.tags ?? [],
    createdAt: toDate(doc.createdAt) ?? new Date(doc._creationTime),
    updatedAt: toDate(doc.updatedAt) ?? new Date(doc._creationTime),
  };
}

export async function getMaintenanceRecordsByOrg(orgId: string): Promise<MaintenanceRecordRow[]> {
  const docs = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.maintenanceRecords.list, { orgId }),
  );
  return docs.map(mapMaintenanceRecord);
}

export async function getMaintenanceRecordById(id: string): Promise<MaintenanceRecordRow | null> {
  const doc = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.maintenanceRecords.getById, { id }),
  );
  return doc ? mapMaintenanceRecord(doc) : null;
}

// ─── Pure filter/sort (replicates the old Prisma where/orderBy) ──────────────

/**
 * Per-record cross-domain join data the `where`/`orderBy` reference. The
 * search OR matches asset tags and the asset model name, so the filter needs
 * the Prisma-attached asset/model strings; orderBy by a User name isn't
 * supported by the old action (sortBy is a scalar column), so users aren't
 * needed here.
 */
export interface MaintenanceJoinData {
  /** assetIds linked to this record (for the `assetId` filter). */
  assetIds: string[];
  /** asset tags linked to this record (for the search OR). */
  assetTags: string[];
  /** model names of the linked assets (for the search OR). */
  modelNames: string[];
}

export interface MaintenanceFilter {
  status?: string;
  type?: string;
  assetId?: string;
  search?: string;
}

function matchesSearch(
  record: MaintenanceRecordRow,
  join: MaintenanceJoinData,
  search: string,
): boolean {
  const needle = search.toLowerCase();
  // Postgres `contains` mode:"insensitive" → case-insensitive substring.
  if (record.title.toLowerCase().includes(needle)) return true;
  if (record.description && record.description.toLowerCase().includes(needle)) return true;
  if (join.assetTags.some((t) => t.toLowerCase().includes(needle))) return true;
  if (join.modelNames.some((n) => n.toLowerCase().includes(needle))) return true;
  return false;
}

/**
 * Replicates the old `getMaintenanceRecords` Prisma `where`: org scope is
 * already applied by the org-scoped Convex query, so this only applies the
 * optional status / type / assetId / search predicates.
 */
export function filterMaintenanceRecords(
  records: MaintenanceRecordRow[],
  joinByRecordId: Map<string, MaintenanceJoinData>,
  filter: MaintenanceFilter,
): MaintenanceRecordRow[] {
  const { status, type, assetId, search } = filter;
  return records.filter((r) => {
    if (status && r.status !== status) return false;
    if (type && r.type !== type) return false;
    const join = joinByRecordId.get(r.id) ?? { assetIds: [], assetTags: [], modelNames: [] };
    if (assetId && !join.assetIds.includes(assetId)) return false;
    if (search && !matchesSearch(r, join, search)) return false;
    return true;
  });
}

// Enum sort ranks follow the DECLARED order in prisma/schema.prisma (Postgres
// enum columns sort by declared order, NOT alphabetically).
const STATUS_RANK: Record<string, number> = {
  SCHEDULED: 0,
  AWAITING_PARTS: 1,
  IN_PROGRESS: 2,
  QA: 3,
  COMPLETED: 4,
  CANCELLED: 5,
};
const TYPE_RANK: Record<string, number> = {
  REPAIR: 0,
  PREVENTATIVE: 1,
  TEST_AND_TAG: 2,
  INSPECTION: 3,
  CLEANING: 4,
  FIRMWARE_UPDATE: 5,
};
const RESULT_RANK: Record<string, number> = {
  PASS: 0,
  FAIL: 1,
  CONDITIONAL: 2,
};

type SortDir = "asc" | "desc";

/** -1 / 0 / 1, with Postgres NULL ordering (ASC → NULLS LAST, DESC → NULLS FIRST). */
function cmpNullable(
  a: number | string | null,
  b: number | string | null,
  dir: SortDir,
): number {
  if (a === null && b === null) return 0;
  // NULLS LAST on asc, NULLS FIRST on desc.
  if (a === null) return dir === "asc" ? 1 : -1;
  if (b === null) return dir === "asc" ? -1 : 1;
  let base: number;
  if (typeof a === "string" && typeof b === "string") base = a < b ? -1 : a > b ? 1 : 0;
  else base = (a as number) - (b as number);
  return dir === "asc" ? base : -base;
}

function sortKeyValue(r: MaintenanceRecordRow, key: string): number | string | null {
  switch (key) {
    case "status":
      return STATUS_RANK[r.status] ?? Number.MAX_SAFE_INTEGER;
    case "type":
      return TYPE_RANK[r.type] ?? Number.MAX_SAFE_INTEGER;
    case "result":
      return r.result === null ? null : RESULT_RANK[r.result] ?? Number.MAX_SAFE_INTEGER;
    case "title":
      return r.title;
    case "scheduledDate":
      return r.scheduledDate ? r.scheduledDate.getTime() : null;
    case "completedDate":
      return r.completedDate ? r.completedDate.getTime() : null;
    case "nextDueDate":
      return r.nextDueDate ? r.nextDueDate.getTime() : null;
    case "createdAt":
      return r.createdAt.getTime();
    case "updatedAt":
      return r.updatedAt.getTime();
    case "cost":
      return r.cost;
    default:
      // Unknown sortBy column: fall back to a stable scalar (createdAt) so we
      // never throw. The old action passed the column straight to Prisma; an
      // invalid column would have errored there, but the UI only ever sends a
      // known scalar sortKey.
      return r.createdAt.getTime();
  }
}

/**
 * Replicates the old `getMaintenanceRecords` `orderBy`:
 *   - explicit `sortBy` → single scalar column, given direction (default asc)
 *   - default → [{ status: asc }, { scheduledDate: asc }]
 */
export function sortMaintenanceRecords(
  records: MaintenanceRecordRow[],
  sortBy?: string,
  sortOrder: SortDir = "asc",
): MaintenanceRecordRow[] {
  const out = [...records];
  if (sortBy) {
    out.sort((a, b) =>
      cmpNullable(sortKeyValue(a, sortBy), sortKeyValue(b, sortBy), sortOrder),
    );
  } else {
    out.sort((a, b) => {
      const byStatus = cmpNullable(sortKeyValue(a, "status"), sortKeyValue(b, "status"), "asc");
      if (byStatus !== 0) return byStatus;
      return cmpNullable(sortKeyValue(a, "scheduledDate"), sortKeyValue(b, "scheduledDate"), "asc");
    });
  }
  return out;
}

/**
 * Distinct-tag aggregation feed: an org's maintenance records normalised to the
 * `{ tags }` shape `getOrgTags` consumes. `tags` is Prisma-defaulted to `[]`, so a
 * Convex doc with the field absent coerces to an empty array. (Phase A — backs
 * the maintenance-tags arm of `tags.ts:getOrgTags`.)
 */
export async function getMaintenanceTagsByOrg(
  organizationId: string,
): Promise<{ tags: string[] }[]> {
  const client = await getConvexClient();
  const docs = await client.query(api.maintenanceRecords.list, { orgId: organizationId });
  return docs.map((d) => ({ tags: d.tags ?? [] }));
}

// ─── Dashboard / project-cost aggregates (Phase A) ───────────────────────────

/** Statuses that count as "open" maintenance work. */
const OPEN_MAINTENANCE_STATUSES = new Set(["SCHEDULED", "IN_PROGRESS"]);

/**
 * Count of open maintenance whose scheduled date has arrived (<= cutoffMs).
 * Replicates Prisma `count({ status: { in: [SCHEDULED, IN_PROGRESS] },
 * scheduledDate: { lte: now } })`. Operates on the mapped MaintenanceRecordRow
 * (scheduledDate is a Date | null; a null date never matches, like Prisma `lte`).
 */
export function countDueMaintenance(
  records: MaintenanceRecordRow[],
  cutoffMs: number,
): number {
  return records.filter(
    (m) =>
      OPEN_MAINTENANCE_STATUSES.has(m.status) &&
      m.scheduledDate != null &&
      m.scheduledDate.getTime() <= cutoffMs,
  ).length;
}

export interface MaintenanceProjectAggregate {
  /** Sum of `cost` over non-CANCELLED records for the project (null cost = 0). */
  costTotal: number;
  /** Count of non-CANCELLED records for the project. */
  count: number;
}

/**
 * Per-project maintenance aggregate over the mapped rows. Replicates Prisma
 * `aggregate({ where: { projectId, status: { notIn: [CANCELLED] } }, _sum: { cost },
 * _count: true })` (Convex `list` is org-scoped → filter to the project here).
 */
export function aggregateMaintenanceForProject(
  records: MaintenanceRecordRow[],
  projectId: string,
): MaintenanceProjectAggregate {
  let costTotal = 0;
  let count = 0;
  for (const m of records) {
    if (m.projectId !== projectId) continue;
    if (m.status === "CANCELLED") continue;
    count += 1;
    costTotal += m.cost ?? 0;
  }
  return { costTotal, count };
}
