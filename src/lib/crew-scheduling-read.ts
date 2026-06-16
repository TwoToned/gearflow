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

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;

export interface CrewAssignmentRow {
  id: string;
  organizationId: string;
  projectId: string;
  crewMemberId: string;
  crewRoleId: string | null;
  status: string;
  phase: string | null;
  isProjectManager: boolean;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date | null;
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
  status: string;
}

export interface CrewCertificationRow {
  id: string;
  crewMemberId: string;
  status: string;
}

export function mapAssignment(d: RawAssignment): CrewAssignmentRow {
  return {
    id: d.id,
    organizationId: req(d.organizationId),
    projectId: req(d.projectId),
    crewMemberId: req(d.crewMemberId),
    crewRoleId: orNull(d.crewRoleId),
    status: req(d.status),
    phase: orNull(d.phase),
    isProjectManager: d.isProjectManager ?? false,
    startDate: toDate(d.startDate),
    endDate: toDate(d.endDate),
    createdAt: toDate(d.createdAt),
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
    status: req(d.status),
  };
}

export function mapCertification(d: RawCertification): CrewCertificationRow {
  return { id: d.id, crewMemberId: req(d.crewMemberId), status: req(d.status) };
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
