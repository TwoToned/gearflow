"use server";

import { getCurrentRole, requirePermission } from "@/lib/org-context";
import { getAmbientActor } from "@/lib/request-actor";
import { isManagerPlusRole } from "@/lib/permissions";
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getTimeEntriesByOrg,
  getAssignmentsByOrg,
  type MappedCrewTimeEntry,
} from "@/lib/crew-scheduling-read";
import { timesheetCsv, type TimesheetCsvRow } from "@/lib/timesheet-csv";
import { timesheetExportFiltersSchema, type TimesheetExportFilters } from "@/lib/validations/crew";
import type { z } from "zod";
import { deriveEntryMoney, type EntryMoney } from "../../convex/lib/timeEntryMoney";

// The time-entry reads + CRUD + status machine are browser-direct (Phase 3):
// convex/crewTimeEntriesWrites.ts + convex/crewTimeEntries.ts (allEntries/forMember).
// Only the Node-side CSV export stays here (it stays server per the KEEP set).

// ─── CSV Export ──────────────────────────────────────────────────────────────

type ExportFilters = z.output<typeof timesheetExportFiltersSchema>;

/**
 * D49: pay columns only for a signed-in manager+ (the same `isManagerPlusRole`
 * the Convex reads use). An API-key actor never gets them here — keys reach
 * pay only through the Convex reads, where `noFinancials` is enforced.
 */
async function callerSeesPay(): Promise<boolean> {
  if (getAmbientActor()) return false;
  return isManagerPlusRole(await getCurrentRole());
}

/** One predicate per export filter; an unset filter passes. */
function matches(e: MappedCrewTimeEntry, f: ExportFilters, projectOf: (e: MappedCrewTimeEntry) => string | null): boolean {
  const t = e.date.getTime();
  const checks: [unknown, () => boolean][] = [
    [f.ids, () => f.ids!.includes(e.id)],
    [f.crewMemberId, () => e.crewMemberId === f.crewMemberId],
    [f.status, () => e.status === f.status],
    [f.projectId, () => projectOf(e) === f.projectId],
    [f.dateFrom, () => t >= new Date(f.dateFrom!).getTime()],
    [f.dateTo, () => t <= new Date(f.dateTo!).getTime()],
  ];
  return checks.every(([set, ok]) => !set || ok());
}

/** One CSV row; `pay` only when the caller may see it. */
function csvRow(
  e: MappedCrewTimeEntry,
  j: { member?: { firstName?: string; lastName?: string; email?: string | null }; project?: { projectNumber?: string; name?: string } | null; roleName?: string; pay?: EntryMoney },
): TimesheetCsvRow {
  const { member, project, pay } = j;
  return {
    name: `${str(member?.firstName)} ${str(member?.lastName)}`,
    email: str(member?.email),
    projectNumber: str(project?.projectNumber),
    projectName: str(project?.name),
    role: str(j.roleName),
    description: str(e.description),
    date: e.date.toISOString().split("T")[0],
    startTime: e.startTime,
    endTime: e.endTime,
    breakMinutes: e.breakMinutes,
    totalHours: e.totalHours,
    status: e.status,
    queryReason: str(e.queryReason),
    ...(pay ? { pay: { rate: pay.rate, total: pay.total, included: pay.included } } : {}),
  };
}

const str = (s: string | null | undefined): string => s || "";

export async function exportTimesheetCSV(input?: TimesheetExportFilters) {
  const { organizationId } = await requirePermission("crew", "read");
  const filters = timesheetExportFiltersSchema.parse(input ?? {});
  const withPay = await callerSeesPay();

  // All reads come from Convex (timeEntry/assignment dual-written; crewMember,
  // crewRole, project Convex-backed). Replicates the Prisma where + orderBy in JS.
  const [allEntries, assignments, members, roleMap, projects] = await Promise.all([
    getTimeEntriesByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const projectOf = (e: MappedCrewTimeEntry) => (e.assignmentId ? assignmentById.get(e.assignmentId)?.projectId ?? null : null);

  // Pay is derived over EVERY entry (the day-rate carrier must not depend on the
  // filters), exactly as `crewTimeEntries.allEntries` does — one derivation.
  const money: Map<string, EntryMoney> | null = withPay
    ? deriveEntryMoney(
        allEntries.map((e) => ({ ...e, date: e.date.getTime() })),
        { assignment: (id) => assignmentById.get(id), member: (id) => memberById.get(id), role: (id) => roleMap.get(id) },
      )
    : null;

  const rows: TimesheetCsvRow[] = allEntries
    .filter((e) => matches(e, filters, projectOf))
    // orderBy [{ date: "asc" }, { crewMemberId: "asc" }]
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.crewMemberId.localeCompare(b.crewMemberId))
    .map((e) => {
      const assignment = e.assignmentId ? assignmentById.get(e.assignmentId) : null;
      return csvRow(e, {
        member: memberById.get(e.crewMemberId),
        project: assignment ? projectsById.get(assignment.projectId) : null,
        roleName: assignment?.crewRoleId ? roleMap.get(assignment.crewRoleId)?.name : undefined,
        pay: money?.get(e.id),
      });
    });

  return timesheetCsv(rows, withPay);
}
