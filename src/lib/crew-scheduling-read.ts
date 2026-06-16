import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the project-coupled crew scheduling sub-tables
 * (crew_assignment / crew_time_entry / crew_shift / crew_certification) — Phase A
 * read-rewiring of the Convex domain-only decommission.
 *
 * All four are dual-written (see src/lib/crew-scheduling-mirror.ts). These helpers
 * read the Convex copy and shape it back into the Prisma-row form the crew
 * dashboard expects (epoch-ms → Date, absent optionals → null, Decimal → number).
 * Members/roles come from `crew-read.ts`; projects from `projects-read.ts`;
 * `testedBy`/`approvedBy`/`confirmedBy` users stay on Prisma (auth, out of scope).
 *
 * `crew_shift` and `crew_certification` have no org column (parent-scoped), so the
 * hand-added `crewShifts.listByOrg` / `crewCertifications.listByOrg` queries join
 * via crewAssignments / crewMembers respectively.
 */

type RawAssignment = Doc<"crewAssignments">;
type RawTimeEntry = Doc<"crewTimeEntries">;
type RawShift = Doc<"crewShifts">;
type RawCertification = Doc<"crewCertifications">;
type RawAvailability = Doc<"crewAvailabilities">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;

export interface CrewAssignmentRow {
  id: string;
  organizationId: string;
  projectId: string;
  crewMemberId: string;
  crewRoleId: string | null;
  serviceId: string | null;
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
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CrewTimeEntryRow {
  id: string;
  organizationId: string;
  assignmentId: string | null;
  crewMemberId: string;
  description: string | null;
  date: Date;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  totalHours: number | null;
  status: string;
  approvedById: string | null;
  approvedAt: Date | null;
  notes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CrewShiftRow {
  id: string;
  assignmentId: string;
  date: Date;
  callTime: string | null;
  endTime: string | null;
  breakMinutes: number | null;
  location: string | null;
  notes: string | null;
  status: string;
}

export interface CrewCertificationRow {
  id: string;
  crewMemberId: string;
  status: string;
}

export interface CrewAvailabilityRow {
  id: string;
  crewMemberId: string;
  type: string;
  startDate: Date;
  endDate: Date;
}

export function mapAssignment(d: RawAssignment): CrewAssignmentRow {
  return {
    id: d.id,
    organizationId: req(d.organizationId),
    projectId: req(d.projectId),
    crewMemberId: req(d.crewMemberId),
    crewRoleId: orNull(d.crewRoleId),
    serviceId: orNull(d.serviceId),
    status: req(d.status),
    phase: orNull(d.phase),
    isProjectManager: d.isProjectManager ?? false,
    startDate: toDate(d.startDate),
    startTime: orNull(d.startTime),
    endDate: toDate(d.endDate),
    endTime: orNull(d.endTime),
    rateOverride: orNull(d.rateOverride),
    rateType: orNull(d.rateType),
    estimatedHours: orNull(d.estimatedHours),
    estimatedCost: orNull(d.estimatedCost),
    notes: orNull(d.notes),
    internalNotes: orNull(d.internalNotes),
    responseToken: orNull(d.responseToken),
    offeredAt: toDate(d.offeredAt),
    respondedAt: toDate(d.respondedAt),
    responseNote: orNull(d.responseNote),
    confirmedAt: toDate(d.confirmedAt),
    confirmedById: orNull(d.confirmedById),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function mapTimeEntry(d: RawTimeEntry): CrewTimeEntryRow {
  return {
    id: d.id,
    organizationId: req(d.organizationId),
    assignmentId: orNull(d.assignmentId),
    crewMemberId: req(d.crewMemberId),
    description: orNull(d.description),
    date: new Date(req(d.date)),
    startTime: req(d.startTime),
    endTime: req(d.endTime),
    breakMinutes: d.breakMinutes ?? 0,
    totalHours: orNull(d.totalHours),
    status: req(d.status),
    approvedById: orNull(d.approvedById),
    approvedAt: toDate(d.approvedAt),
    notes: orNull(d.notes),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function mapShift(d: RawShift): CrewShiftRow {
  return {
    id: d.id,
    assignmentId: req(d.assignmentId),
    date: new Date(req(d.date)),
    callTime: orNull(d.callTime),
    endTime: orNull(d.endTime),
    breakMinutes: orNull(d.breakMinutes),
    location: orNull(d.location),
    notes: orNull(d.notes),
    status: req(d.status),
  };
}

export function mapCertification(d: RawCertification): CrewCertificationRow {
  return { id: d.id, crewMemberId: req(d.crewMemberId), status: req(d.status) };
}

export function mapAvailability(d: RawAvailability): CrewAvailabilityRow {
  return {
    id: d.id,
    crewMemberId: req(d.crewMemberId),
    // `type` is optional in Convex; Prisma defaults it to UNAVAILABLE, so an
    // absent value means UNAVAILABLE (don't drop it — the filter compares on it).
    type: d.type ?? "UNAVAILABLE",
    startDate: new Date(req(d.startDate)),
    endDate: new Date(req(d.endDate)),
  };
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export async function getAssignmentsByOrg(orgId: string): Promise<CrewAssignmentRow[]> {
  const rows = (await (await getConvexClient()).query(api.crewAssignments.list, { orgId })) as RawAssignment[];
  return rows.map(mapAssignment);
}

export async function getTimeEntriesByOrg(orgId: string): Promise<CrewTimeEntryRow[]> {
  const rows = (await (await getConvexClient()).query(api.crewTimeEntries.list, { orgId })) as RawTimeEntry[];
  return rows.map(mapTimeEntry);
}

export async function getShiftsByOrg(orgId: string): Promise<CrewShiftRow[]> {
  const rows = (await (await getConvexClient()).query(api.crewShifts.listByOrg, { orgId })) as RawShift[];
  return rows.map(mapShift);
}

export async function getCertificationsByOrg(orgId: string): Promise<CrewCertificationRow[]> {
  const rows = (await (await getConvexClient()).query(api.crewCertifications.listByOrg, { orgId })) as RawCertification[];
  return rows.map(mapCertification);
}

/**
 * Availability blocks for a set of crew members. `orgId` only gates Convex auth;
 * rows are NOT org-filtered (organizationId is optional on the table — see the
 * `crewAvailabilities.listByCrewMemberIds` query). Empty input short-circuits.
 */
export async function getAvailabilitiesByCrewMemberIds(
  crewMemberIds: string[],
  orgId: string,
): Promise<CrewAvailabilityRow[]> {
  if (crewMemberIds.length === 0) return [];
  const rows = (await (await getConvexClient()).query(api.crewAvailabilities.listByCrewMemberIds, {
    crewMemberIds,
    orgId,
  })) as RawAvailability[];
  return rows.map(mapAvailability);
}

export async function getAssignmentsByProject(projectId: string, orgId: string): Promise<CrewAssignmentRow[]> {
  const rows = (await (await getConvexClient()).query(api.crewAssignments.listByProject, {
    projectId,
    orgId,
  })) as RawAssignment[];
  return rows.map(mapAssignment);
}

/** Project services keyed by cuid, reduced to `{ id, title, type }` for attach. */
export async function getProjectServiceMap(orgId: string): Promise<Map<string, { id: string; title: string; type: string }>> {
  const rows = (await (await getConvexClient()).query(api.projectServices.list, { orgId })) as Array<{
    id: string;
    title: string;
    type: string;
  }>;
  return new Map(rows.map((s) => [s.id, { id: s.id, title: s.title, type: s.type }]));
}
