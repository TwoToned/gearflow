import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the crew SCHEDULING tables (Phase A read-rewiring).
 *
 * crewAssignment / crewShift / crewAvailability / crewTimeEntry are Convex-only
 * (since the Phase C crew-scheduling write-inversion; the mirror is deleted)
 * and backfilled (scripts/convex-backfill-crew-scheduling.ts +
 * convex-backfill-crew-availability-org.ts). The pure read-only server actions in
 * server/crew-dashboard.ts, crew-time.ts, crew-assignments.ts, crew-availability.ts
 * and crew-calendar.ts read the Convex copy through these helpers; cross-domain
 * joins onto crew members / roles reuse src/lib/crew-read.ts maps, onto projects
 * reuse src/lib/projects-read.ts, onto locations reuse src/lib/locations-read.ts,
 * and onto Better Auth User (approvedBy / confirmedBy) stay Prisma (batched by the
 * caller). DEPLOY-GATED: the crew-scheduling tables must be backfilled into prod
 * Convex before these reads deploy, else existing rows read empty. See FEATUREDOCS/54.
 *
 * Mapping conventions (Convex doc -> old Prisma row shape, so consumers and the
 * `serialize()` boundary behave identically): epoch-ms numbers -> Date (serialize
 * keeps Date), numeric money/hours stay numbers (Convex has no Decimal), absent
 * optional fields -> null, Prisma-defaulted columns coerced non-null, `_id` /
 * `_creationTime` stripped. NO Prisma fallback on a Convex map miss — a miss reads
 * null, like a join against a deleted row.
 */

// ─── Raw Convex doc types ────────────────────────────────────────────────────
export type ConvexCrewAssignment = Doc<"crewAssignments">;
export type ConvexCrewShift = Doc<"crewShifts">;
export type ConvexCrewAvailability = Doc<"crewAvailabilities">;
export type ConvexCrewTimeEntry = Doc<"crewTimeEntries">;

// ─── Mapped (Prisma-shaped) types ────────────────────────────────────────────
// Derived from the raw Convex doc types above (R-8.2.4) rather than hand-
// duplicated field-by-field, so a schema change (new/renamed field) is a
// compile error here instead of a silently-stale duplicate.
export type MappedCrewAssignment = Omit<
  ConvexCrewAssignment,
  | "_id"
  | "_creationTime"
  | "crewRoleId"
  | "status"
  | "phase"
  | "isProjectManager"
  | "startDate"
  | "startTime"
  | "endDate"
  | "endTime"
  | "rateOverride"
  | "rateType"
  | "estimatedHours"
  | "estimatedCost"
  | "notes"
  | "internalNotes"
  | "responseToken"
  | "offeredAt"
  | "respondedAt"
  | "responseNote"
  | "confirmedAt"
  | "confirmedById"
  | "serviceId"
  | "createdAt"
  | "updatedAt"
> & {
  crewRoleId: string | null;
  status: string;
  phase: string | null;
  isProjectManager: boolean;
  startDate: Date | null;
  startTime: string | null;
  endDate: Date | null;
  endTime: string | null;
  rateOverride: number | null;
  rateType: string | null;
  estimatedHours: number | null;
  estimatedCost: number | null;
  notes: string | null;
  internalNotes: string | null;
  responseToken: string | null;
  offeredAt: Date | null;
  respondedAt: Date | null;
  responseNote: string | null;
  confirmedAt: Date | null;
  confirmedById: string | null;
  serviceId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MappedCrewShift = Omit<
  ConvexCrewShift,
  "_id" | "_creationTime" | "date" | "callTime" | "endTime" | "breakMinutes" | "location" | "notes" | "status"
> & {
  date: Date;
  callTime: string | null;
  endTime: string | null;
  breakMinutes: number | null;
  location: string | null;
  notes: string | null;
  status: string;
};

export type MappedCrewAvailability = Omit<
  ConvexCrewAvailability,
  | "_id"
  | "_creationTime"
  | "organizationId"
  | "startDate"
  | "endDate"
  | "type"
  | "reason"
  | "isAllDay"
  | "startTime"
  | "endTime"
  | "createdAt"
  | "updatedAt"
> & {
  organizationId: string | null;
  startDate: Date;
  endDate: Date;
  type: string;
  reason: string | null;
  isAllDay: boolean;
  startTime: string | null;
  endTime: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MappedCrewTimeEntry = Omit<
  ConvexCrewTimeEntry,
  | "_id"
  | "_creationTime"
  | "assignmentId"
  | "description"
  | "date"
  | "breakMinutes"
  | "totalHours"
  | "status"
  | "approvedById"
  | "approvedAt"
  | "notes"
  | "createdAt"
  | "updatedAt"
> & {
  assignmentId: string | null;
  description: string | null;
  date: Date;
  breakMinutes: number;
  totalHours: number | null;
  status: string;
  approvedById: string | null;
  approvedAt: Date | null;
  notes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

// ─── Map helpers (epoch -> Date, absent -> null, defaulted -> non-null) ───────
const toDate = (ms: number | null | undefined): Date | null =>
  ms == null ? null : new Date(ms);

export function mapAssignment(d: ConvexCrewAssignment): MappedCrewAssignment {
  return {
    id: d.id,
    organizationId: d.organizationId,
    projectId: d.projectId,
    crewMemberId: d.crewMemberId,
    crewRoleId: d.crewRoleId ?? null,
    status: d.status ?? "PENDING",
    phase: d.phase ?? null,
    isProjectManager: d.isProjectManager ?? false,
    startDate: toDate(d.startDate),
    startTime: d.startTime ?? null,
    endDate: toDate(d.endDate),
    endTime: d.endTime ?? null,
    rateOverride: d.rateOverride ?? null,
    rateType: d.rateType ?? null,
    estimatedHours: d.estimatedHours ?? null,
    estimatedCost: d.estimatedCost ?? null,
    notes: d.notes ?? null,
    internalNotes: d.internalNotes ?? null,
    responseToken: d.responseToken ?? null,
    offeredAt: toDate(d.offeredAt),
    respondedAt: toDate(d.respondedAt),
    responseNote: d.responseNote ?? null,
    confirmedAt: toDate(d.confirmedAt),
    confirmedById: d.confirmedById ?? null,
    serviceId: d.serviceId ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function mapShift(d: ConvexCrewShift): MappedCrewShift {
  return {
    id: d.id,
    assignmentId: d.assignmentId,
    date: new Date(d.date),
    callTime: d.callTime ?? null,
    endTime: d.endTime ?? null,
    breakMinutes: d.breakMinutes ?? null,
    location: d.location ?? null,
    notes: d.notes ?? null,
    status: d.status ?? "SCHEDULED",
  };
}

export function mapAvailability(d: ConvexCrewAvailability): MappedCrewAvailability {
  return {
    id: d.id,
    crewMemberId: d.crewMemberId,
    organizationId: d.organizationId ?? null,
    startDate: new Date(d.startDate),
    endDate: new Date(d.endDate),
    type: d.type ?? "UNAVAILABLE",
    reason: d.reason ?? null,
    isAllDay: d.isAllDay ?? true,
    startTime: d.startTime ?? null,
    endTime: d.endTime ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function mapTimeEntry(d: ConvexCrewTimeEntry): MappedCrewTimeEntry {
  return {
    id: d.id,
    organizationId: d.organizationId,
    assignmentId: d.assignmentId ?? null,
    crewMemberId: d.crewMemberId,
    description: d.description ?? null,
    date: new Date(d.date),
    startTime: d.startTime,
    endTime: d.endTime,
    breakMinutes: d.breakMinutes ?? 0,
    totalHours: d.totalHours ?? null,
    status: d.status ?? "DRAFT",
    approvedById: d.approvedById ?? null,
    approvedAt: toDate(d.approvedAt),
    notes: d.notes ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

// ─── Fetchers ────────────────────────────────────────────────────────────────
export async function getAssignmentsByOrg(orgId: string): Promise<MappedCrewAssignment[]> {
  const rows = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewAssignments.list, { orgId }),
  );
  return rows.map(mapAssignment);
}

export async function getAssignmentsByProject(
  projectId: string,
  orgId: string,
): Promise<MappedCrewAssignment[]> {
  const rows = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewAssignments.listByProject, { projectId, orgId }),
  );
  return rows.map(mapAssignment);
}

export async function getAssignmentById(id: string): Promise<MappedCrewAssignment | null> {
  const row = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewAssignments.getById, { id }),
  );
  return row ? mapAssignment(row) : null;
}

export async function getTimeEntriesByOrg(orgId: string): Promise<MappedCrewTimeEntry[]> {
  const rows = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewTimeEntries.list, { orgId }),
  );
  return rows.map(mapTimeEntry);
}

export async function getShiftsByAssignmentIds(
  assignmentIds: string[],
): Promise<MappedCrewShift[]> {
  if (assignmentIds.length === 0) return [];
  const rows = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewShifts.listByAssignmentIds, { assignmentIds }),
  );
  return rows.map(mapShift);
}

/**
 * Availability for a set of crew members. `organizationId` is OPTIONAL on the
 * crewAvailabilities table, so this uses the by_crewMemberId access path (the
 * caller has already org-scoped the member ids), per the gate note.
 */
export async function getAvailabilityByCrewMemberIds(
  crewMemberIds: string[],
): Promise<MappedCrewAvailability[]> {
  if (crewMemberIds.length === 0) return [];
  const rows = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewAvailabilities.listByCrewMemberIds, { crewMemberIds }),
  );
  return rows.map(mapAvailability);
}

// ─── Pure filter / sort / aggregate functions (unit-tested) ───────────────────

/**
 * Postgres enum columns sort by DECLARED order (not alphabetical). Rank maps
 * replicate `orderBy: { <enum>: "asc" }`. Declared order from prisma/schema.prisma.
 */
export const PROJECT_PHASE_RANK: Record<string, number> = {
  BUMP_IN: 0,
  EVENT: 1,
  BUMP_OUT: 2,
  DELIVERY: 3,
  PICKUP: 4,
  SETUP: 5,
  REHEARSAL: 6,
  FULL_DURATION: 7,
};

const ACTIVE_ASSIGNMENT_STATUSES = new Set(["CONFIRMED", "ACCEPTED"]);
const PENDING_OFFER_STATUSES = new Set(["PENDING", "OFFERED"]);
const EXCLUDED_ASSIGNMENT_STATUSES = new Set(["CANCELLED", "DECLINED"]);

/** Generic ascending compare, Postgres ASC = NULLS LAST. */
export function compareAscNullsLast<T>(
  a: T | null | undefined,
  b: T | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Descending compare, Postgres DESC = NULLS FIRST. */
export function compareDescNullsFirst<T>(
  a: T | null | undefined,
  b: T | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1; // nulls first
  if (b == null) return 1;
  return a < b ? 1 : a > b ? -1 : 0;
}

// ── crew-dashboard ──

/** getCrewDashboardStats: confirmed assignments still running (endDate >= now OR null). */
export function countActiveConfirmedAssignments(
  assignments: MappedCrewAssignment[],
  now: Date,
): number {
  return assignments.filter(
    (a) =>
      a.status === "CONFIRMED" && (a.endDate == null || a.endDate.getTime() >= now.getTime()),
  ).length;
}

/** getCrewDashboardStats / getPendingOffers count: status in PENDING|OFFERED. */
export function countPendingOffers(assignments: MappedCrewAssignment[]): number {
  return assignments.filter((a) => PENDING_OFFER_STATUSES.has(a.status)).length;
}

/** getCrewDashboardStats: time entries with status SUBMITTED. */
export function countSubmittedTimeEntries(entries: MappedCrewTimeEntry[]): number {
  return entries.filter((e) => e.status === "SUBMITTED").length;
}

/** getCrewDashboardStats: sum totalHours of APPROVED|EXPORTED entries since weekAgo. */
export function sumHoursThisWeek(
  entries: MappedCrewTimeEntry[],
  weekAgo: Date,
): number {
  return entries
    .filter(
      (e) =>
        (e.status === "APPROVED" || e.status === "EXPORTED") &&
        e.date.getTime() >= weekAgo.getTime(),
    )
    .reduce((sum, e) => sum + (e.totalHours ?? 0), 0);
}

/** getActiveAssignmentsSummary filter: status in CONFIRMED|ACCEPTED, running, sorted startDate asc, take 20. */
export function selectActiveAssignmentsSummary(
  assignments: MappedCrewAssignment[],
  now: Date,
): MappedCrewAssignment[] {
  return assignments
    .filter(
      (a) =>
        ACTIVE_ASSIGNMENT_STATUSES.has(a.status) &&
        (a.endDate == null || a.endDate.getTime() >= now.getTime()),
    )
    .sort((a, b) => compareAscNullsLast(a.startDate?.getTime(), b.startDate?.getTime()))
    .slice(0, 20);
}

/** getPendingOffers filter: status in PENDING|OFFERED, sorted createdAt desc, take 15. */
export function selectPendingOffers(
  assignments: MappedCrewAssignment[],
): MappedCrewAssignment[] {
  return assignments
    .filter((a) => PENDING_OFFER_STATUSES.has(a.status))
    .sort((a, b) => compareDescNullsFirst(a.createdAt?.getTime(), b.createdAt?.getTime()))
    .slice(0, 15);
}

/** getPendingTimeEntries filter: status SUBMITTED, sorted date desc, take 15. */
export function selectPendingTimeEntries(
  entries: MappedCrewTimeEntry[],
): MappedCrewTimeEntry[] {
  return entries
    .filter((e) => e.status === "SUBMITTED")
    .sort((a, b) => compareDescNullsFirst(a.date.getTime(), b.date.getTime()))
    .slice(0, 15);
}

/**
 * getCrewPickerList sub-list: a member's assignments excluding CANCELLED|DECLINED,
 * sorted startDate desc. (The member-level fetch/sort is done in the action.)
 */
export function selectMemberPickerAssignments(
  assignments: MappedCrewAssignment[],
): MappedCrewAssignment[] {
  return assignments
    .filter((a) => !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status))
    .sort((a, b) => compareDescNullsFirst(a.startDate?.getTime(), b.startDate?.getTime()));
}

/**
 * getUpcomingShifts filter: shift status SCHEDULED, date >= startOfToday, and the
 * shift's assignment is in the org (caller passes the org assignment-id set).
 * Sorted date asc, take 10.
 */
export function selectUpcomingShifts(
  shifts: MappedCrewShift[],
  orgAssignmentIds: Set<string>,
  startOfToday: Date,
): MappedCrewShift[] {
  return shifts
    .filter(
      (s) =>
        s.status === "SCHEDULED" &&
        s.date.getTime() >= startOfToday.getTime() &&
        orgAssignmentIds.has(s.assignmentId),
    )
    .sort((a, b) => compareAscNullsLast(a.date.getTime(), b.date.getTime()))
    .slice(0, 10);
}

// ── crew-assignments ──

/** getProjectCrew sort: isProjectManager desc, phase asc (declared order, null last), member lastName asc. */
export function sortProjectCrew<
  T extends { isProjectManager: boolean; phase: string | null },
>(rows: T[], lastNameOf: (row: T) => string | null | undefined): T[] {
  return [...rows].sort((a, b) => {
    // isProjectManager desc (true before false)
    if (a.isProjectManager !== b.isProjectManager) return a.isProjectManager ? -1 : 1;
    // phase asc by declared rank, nulls last
    const ar = a.phase == null ? Number.POSITIVE_INFINITY : PROJECT_PHASE_RANK[a.phase] ?? Number.POSITIVE_INFINITY;
    const br = b.phase == null ? Number.POSITIVE_INFINITY : PROJECT_PHASE_RANK[b.phase] ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    // crewMember.lastName asc, nulls last
    return compareAscNullsLast(lastNameOf(a), lastNameOf(b));
  });
}

/** getProjectLabourCost aggregate: sum estimatedCost + count, over status not in CANCELLED|DECLINED. */
export function aggregateProjectLabourCost(assignments: MappedCrewAssignment[]): {
  totalLabourCost: number;
  assignmentCount: number;
} {
  const eligible = assignments.filter((a) => !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status));
  return {
    totalLabourCost: eligible.reduce((sum, a) => sum + (a.estimatedCost ?? 0), 0),
    assignmentCount: eligible.length,
  };
}

/** Shifts for one assignment, sorted date asc (getProjectCrew shifts include). */
export function shiftsForAssignmentSortedAsc(
  shifts: MappedCrewShift[],
  assignmentId: string,
): MappedCrewShift[] {
  return shifts
    .filter((s) => s.assignmentId === assignmentId)
    .sort((a, b) => compareAscNullsLast(a.date.getTime(), b.date.getTime()));
}

// ── crew-time ──

const TIME_ENTRY_SORT_KEYS = new Set(["date", "crewMember", "startTime", "totalHours", "status"]);

export interface TimeEntrySortContext {
  /** crewMember lastName, for the "crewMember" sort key. */
  lastNameOf: (entry: MappedCrewTimeEntry) => string | null | undefined;
}

/**
 * getAllTimeEntries ordering. Mirrors the Prisma orderByMap: by chosen key, with a
 * secondary `startTime` desc tie-break ONLY when sorting by date (matches Prisma).
 */
export function sortTimeEntries(
  entries: MappedCrewTimeEntry[],
  sortBy: string,
  sortOrder: "asc" | "desc",
  ctx: TimeEntrySortContext,
): MappedCrewTimeEntry[] {
  const key = TIME_ENTRY_SORT_KEYS.has(sortBy) ? sortBy : "date";
  const cmp = sortOrder === "asc" ? compareAscNullsLast : compareDescNullsFirst;
  const valueOf = (e: MappedCrewTimeEntry): string | number | null | undefined => {
    switch (key) {
      case "crewMember":
        return ctx.lastNameOf(e);
      case "startTime":
        return e.startTime;
      case "totalHours":
        return e.totalHours;
      case "status":
        return e.status;
      case "date":
      default:
        return e.date.getTime();
    }
  };
  return [...entries].sort((a, b) => {
    const primary = cmp(valueOf(a), valueOf(b));
    if (primary !== 0) return primary;
    if (key === "date") {
      // secondary startTime desc (NULLS FIRST)
      return compareDescNullsFirst(a.startTime, b.startTime);
    }
    return 0;
  });
}

export interface TimeEntryFilterContext {
  /** crewMember first/last name + email, for search. */
  nameOf: (entry: MappedCrewTimeEntry) => { firstName: string; lastName: string };
  /** project name + number for the entry's assignment, for search. */
  projectOf: (entry: MappedCrewTimeEntry) => { name: string; projectNumber: string } | null;
}

/**
 * getAllTimeEntries where-clause. organizationId scoping is done by the fetcher
 * (org list). Applies the optional case-insensitive search and the status /
 * crewMemberId `in` filters.
 */
export function filterTimeEntries(
  entries: MappedCrewTimeEntry[],
  params:
    | {
        search?: string;
        filters?: Record<string, unknown>;
      }
    | undefined,
  ctx: TimeEntryFilterContext,
): MappedCrewTimeEntry[] {
  let out = entries;

  const search = params?.search?.trim();
  if (search) {
    const needle = search.toLowerCase();
    out = out.filter((e) => {
      const { firstName, lastName } = ctx.nameOf(e);
      const project = ctx.projectOf(e);
      return (
        firstName.toLowerCase().includes(needle) ||
        lastName.toLowerCase().includes(needle) ||
        (e.description ?? "").toLowerCase().includes(needle) ||
        (project?.name ?? "").toLowerCase().includes(needle) ||
        (project?.projectNumber ?? "").toLowerCase().includes(needle)
      );
    });
  }

  if (params?.filters) {
    const f = params.filters as Record<string, string[]>;
    if (f.status?.length) {
      const set = new Set(f.status);
      out = out.filter((e) => set.has(e.status));
    }
    if (f.crewMemberId?.length) {
      const set = new Set(f.crewMemberId);
      out = out.filter((e) => set.has(e.crewMemberId));
    }
  }

  return out;
}

/** Slice a page out of an already-filtered+sorted list (1-based page). */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const p = page > 0 ? page : 1;
  return rows.slice((p - 1) * pageSize, (p - 1) * pageSize + pageSize);
}

/** getTimeEntriesForMember / getTimeEntriesForProject sort: date desc, then startTime desc. */
export function sortTimeEntriesDateThenStartDesc(
  entries: MappedCrewTimeEntry[],
): MappedCrewTimeEntry[] {
  return [...entries].sort((a, b) => {
    const byDate = compareDescNullsFirst(a.date.getTime(), b.date.getTime());
    if (byDate !== 0) return byDate;
    return compareDescNullsFirst(a.startTime, b.startTime);
  });
}

// ── crew-availability ──

/** Date-overlap test: row overlaps [start, end] when row.startDate <= end AND row.endDate >= start. */
export function overlapsRange(
  rowStart: Date,
  rowEnd: Date,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  return (
    rowStart.getTime() <= rangeEnd.getTime() && rowEnd.getTime() >= rangeStart.getTime()
  );
}

/** Assignment overlaps a range (treats null start/end as open-ended on that side? — no: Prisma uses lte/gte so null dates do NOT match a range). */
export function assignmentOverlapsRange(
  a: MappedCrewAssignment,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  if (a.startDate == null || a.endDate == null) return false;
  return overlapsRange(a.startDate, a.endDate, rangeStart, rangeEnd);
}

/**
 * getCrewAvailability filter: a member's availability, optionally overlapping a
 * range, sorted startDate asc.
 */
export function selectMemberAvailability(
  rows: MappedCrewAvailability[],
  crewMemberId: string,
  range: { start: Date; end: Date } | null,
): MappedCrewAvailability[] {
  return rows
    .filter((r) => r.crewMemberId === crewMemberId)
    .filter((r) => (range ? overlapsRange(r.startDate, r.endDate, range.start, range.end) : true))
    .sort((a, b) => compareAscNullsLast(a.startDate.getTime(), b.startDate.getTime()));
}

/**
 * getCrewAvailabilityStatus: per-member status from availability blocks + active
 * assignments overlapping [start, end]. UNAVAILABLE wins, then TENTATIVE, then
 * busy (an overlapping non-cancelled/declined assignment), default available.
 */
export function computeAvailabilityStatus(
  crewMemberIds: string[],
  blocks: MappedCrewAvailability[],
  assignments: MappedCrewAssignment[],
  range: { start: Date; end: Date },
): Record<string, "available" | "tentative" | "unavailable" | "busy"> {
  const statusMap: Record<string, "available" | "tentative" | "unavailable" | "busy"> = {};
  const memberSet = new Set(crewMemberIds);
  for (const id of crewMemberIds) statusMap[id] = "available";

  for (const b of blocks) {
    if (!memberSet.has(b.crewMemberId)) continue;
    if (!overlapsRange(b.startDate, b.endDate, range.start, range.end)) continue;
    if (b.type === "UNAVAILABLE") {
      statusMap[b.crewMemberId] = "unavailable";
    } else if (b.type === "TENTATIVE" && statusMap[b.crewMemberId] === "available") {
      statusMap[b.crewMemberId] = "tentative";
    }
  }

  for (const a of assignments) {
    if (!memberSet.has(a.crewMemberId)) continue;
    if (EXCLUDED_ASSIGNMENT_STATUSES.has(a.status)) continue;
    if (!assignmentOverlapsRange(a, range.start, range.end)) continue;
    if (statusMap[a.crewMemberId] === "available") {
      statusMap[a.crewMemberId] = "busy";
    }
  }

  return statusMap;
}

/**
 * getCrewPlannerData: a member's planner assignments — exclude CANCELLED|DECLINED,
 * and (overlap [start,end]) OR (startDate == null). Replicates the nested
 * `assignments.where` (no orderBy in the Prisma include → preserve input order).
 */
export function selectPlannerAssignments(
  assignments: MappedCrewAssignment[],
  range: { start: Date; end: Date },
): MappedCrewAssignment[] {
  return assignments.filter((a) => {
    if (EXCLUDED_ASSIGNMENT_STATUSES.has(a.status)) return false;
    if (a.startDate == null) return true;
    // matches { startDate: { lte: end }, endDate: { gte: start } }
    return assignmentOverlapsRange(a, range.start, range.end);
  });
}

/** getCrewPlannerData: a member's planner availability overlapping [start,end]. */
export function selectPlannerAvailability(
  rows: MappedCrewAvailability[],
  range: { start: Date; end: Date },
): MappedCrewAvailability[] {
  return rows.filter((r) => overlapsRange(r.startDate, r.endDate, range.start, range.end));
}

// ── crew-assignments: getCrewMembersForAssignment helpers ──

/**
 * Cross-project conflicts for a member over [start,end]: other-project,
 * non-cancelled/declined assignments whose date window overlaps. Mirrors the
 * Prisma `crewAssignment.findMany({ crewMemberId in, projectId not, status notIn,
 * startDate lte end, endDate gte start })`.
 */
export function selectMemberConflicts(
  assignments: MappedCrewAssignment[],
  crewMemberId: string,
  currentProjectId: string,
  range: { start: Date; end: Date },
): MappedCrewAssignment[] {
  return assignments.filter(
    (a) =>
      a.crewMemberId === crewMemberId &&
      a.projectId !== currentProjectId &&
      !EXCLUDED_ASSIGNMENT_STATUSES.has(a.status) &&
      assignmentOverlapsRange(a, range.start, range.end),
  );
}

/**
 * The set of crew member ids that are UNAVAILABLE over [start,end]: availability
 * blocks of type UNAVAILABLE whose window overlaps the range.
 */
export function selectUnavailableMemberIds(
  blocks: MappedCrewAvailability[],
  range: { start: Date; end: Date },
): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    if (b.type !== "UNAVAILABLE") continue;
    if (overlapsRange(b.startDate, b.endDate, range.start, range.end)) out.add(b.crewMemberId);
  }
  return out;
}

export { EXCLUDED_ASSIGNMENT_STATUSES };

// ─── Raw-doc count helpers (dashboard / notifications, Phase A) ──────────────
// Operate on the raw Convex docs (status scalar only), not the mapped rows,
// backing the cheap dashboard/notification counters.

export async function getCrewAssignmentsByOrg(orgId: string): Promise<ConvexCrewAssignment[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewAssignments.list, { orgId }),
  );
}

export async function getCrewTimeEntriesByOrg(orgId: string): Promise<ConvexCrewTimeEntry[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.crewTimeEntries.list, { orgId }),
  );
}

/** Count of crew assignments whose status is in `statuses` (Prisma `count({ status: { in } })`). */
export function countAssignmentsByStatus(
  assignments: ConvexCrewAssignment[],
  statuses: readonly string[],
): number {
  const set = new Set(statuses);
  return assignments.filter((a) => a.status != null && set.has(a.status)).length;
}

/** Count of crew time entries whose status is in `statuses` (Prisma `count({ status: { in } })`). */
export function countTimeEntriesByStatus(
  entries: ConvexCrewTimeEntry[],
  statuses: readonly string[],
): number {
  const set = new Set(statuses);
  return entries.filter((e) => e.status != null && set.has(e.status)).length;
}
