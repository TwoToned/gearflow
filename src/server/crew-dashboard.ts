"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getAssignmentsByOrg,
  getTimeEntriesByOrg,
  getShiftsByOrg,
  getCertificationsByOrg,
  type CrewAssignmentRow,
} from "@/lib/crew-scheduling-read";

// Crew dashboard reads moved off Prisma to Convex (Phase A read-rewiring of the
// domain-only decommission). Members/roles, scheduling sub-tables, and projects
// all come from Convex; the old Prisma where/orderBy/include become JS
// filter/sort/attach. All functions are read-only.

const ms = (d: Date | null) => (d ? d.getTime() : null);
/** Postgres ASC default = NULLS LAST. */
function cmpDateAsc(a: Date | null, b: Date | null): number {
  const av = ms(a), bv = ms(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av - bv;
}
/** Postgres DESC default = NULLS FIRST. */
function cmpDateDesc(a: Date | null, b: Date | null): number {
  const av = ms(a), bv = ms(b);
  if (av === null && bv === null) return 0;
  if (av === null) return -1;
  if (bv === null) return 1;
  return bv - av;
}

async function projectMap(orgId: string) {
  const projects = await getProjectsByOrg(orgId);
  return new Map(projects.map((p) => [p.id, p]));
}

export async function getCrewPickerList() {
  const { organizationId } = await getOrgContext();

  const [members, roleMap, assignments, projects] = await Promise.all([
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getAssignmentsByOrg(organizationId),
    projectMap(organizationId),
  ]);

  // Assignments per member (exclude cancelled/declined), newest start first.
  const byMember = new Map<string, CrewAssignmentRow[]>();
  for (const a of assignments) {
    if (a.status === "CANCELLED" || a.status === "DECLINED") continue;
    const arr = byMember.get(a.crewMemberId);
    if (arr) arr.push(a);
    else byMember.set(a.crewMemberId, [a]);
  }
  for (const arr of byMember.values()) arr.sort((x, y) => cmpDateDesc(x.startDate, y.startDate));

  const active = members
    .filter((m) => m.isActive !== false && m.status === "ACTIVE")
    .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));

  const result = active.map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    department: m.department ?? null,
    crewRole: m.crewRoleId ? { name: roleMap.get(m.crewRoleId)?.name ?? null } : null,
    assignments: (byMember.get(m.id) ?? []).map((a) => {
      const proj = projects.get(a.projectId);
      return {
        id: a.id,
        status: a.status,
        project: proj ? { id: proj.id, name: proj.name, projectNumber: proj.projectNumber } : null,
        crewRole: a.crewRoleId ? { id: a.crewRoleId, name: roleMap.get(a.crewRoleId)?.name ?? null } : null,
      };
    }),
  }));

  return serialize(result);
}

export async function getCrewDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [members, assignments, timeEntries, certifications] = await Promise.all([
    getCrewMembersByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getTimeEntriesByOrg(organizationId),
    getCertificationsByOrg(organizationId),
  ]);

  const totalActive = members.filter((m) => m.isActive !== false && m.status === "ACTIVE").length;
  const activeAssignments = assignments.filter(
    (a) => a.status === "CONFIRMED" && (a.endDate === null || a.endDate.getTime() >= now.getTime()),
  ).length;
  const pendingOffers = assignments.filter((a) => a.status === "PENDING" || a.status === "OFFERED").length;
  const submittedTime = timeEntries.filter((t) => t.status === "SUBMITTED").length;
  const hoursThisWeek = timeEntries
    .filter((t) => (t.status === "APPROVED" || t.status === "EXPORTED") && t.date.getTime() >= weekAgo.getTime())
    .reduce((sum, t) => sum + (t.totalHours ?? 0), 0);
  const expiringCerts = certifications.filter((c) => c.status === "EXPIRED" || c.status === "EXPIRING_SOON").length;

  return {
    totalActive,
    activeAssignments,
    pendingOffers,
    submittedTime,
    hoursThisWeek: Number(hoursThisWeek || 0),
    expiringCerts,
  };
}

export async function getPendingTimeEntries() {
  const { organizationId } = await getOrgContext();

  const [timeEntries, memberList, roleMap, assignments, projects] = await Promise.all([
    getTimeEntriesByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getAssignmentsByOrg(organizationId),
    projectMap(organizationId),
  ]);
  const memberMap = new Map(memberList.map((m) => [m.id, m]));
  const asgMap = new Map(assignments.map((a) => [a.id, a]));

  const entries = timeEntries
    .filter((t) => t.status === "SUBMITTED")
    .sort((a, b) => cmpDateDesc(a.date, b.date))
    .slice(0, 15)
    .map((t) => {
      const m = memberMap.get(t.crewMemberId);
      const a = t.assignmentId ? asgMap.get(t.assignmentId) : undefined;
      const proj = a ? projects.get(a.projectId) : undefined;
      return {
        ...t,
        crewMember: m ? { firstName: m.firstName, lastName: m.lastName } : null,
        assignment: a
          ? {
              project: proj ? { name: proj.name, projectNumber: proj.projectNumber } : null,
              crewRole: a.crewRoleId ? { name: roleMap.get(a.crewRoleId)?.name ?? null } : null,
            }
          : null,
      };
    });

  return serialize(entries);
}

export async function getActiveAssignmentsSummary() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  const [assignments, memberList, roleMap, projects] = await Promise.all([
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    projectMap(organizationId),
  ]);
  const memberMap = new Map(memberList.map((m) => [m.id, m]));

  const result = assignments
    .filter(
      (a) =>
        (a.status === "CONFIRMED" || a.status === "ACCEPTED") &&
        (a.endDate === null || a.endDate.getTime() >= now.getTime()),
    )
    .sort((a, b) => cmpDateAsc(a.startDate, b.startDate))
    .slice(0, 20)
    .map((a) => {
      const m = memberMap.get(a.crewMemberId);
      const proj = projects.get(a.projectId);
      return {
        ...a,
        crewMember: m ? { id: m.id, firstName: m.firstName, lastName: m.lastName } : null,
        crewRole: a.crewRoleId ? { name: roleMap.get(a.crewRoleId)?.name ?? null } : null,
        project: proj ? { id: proj.id, name: proj.name, projectNumber: proj.projectNumber, status: proj.status } : null,
      };
    });

  return serialize(result);
}

export async function getPendingOffers() {
  const { organizationId } = await getOrgContext();

  const [assignments, memberList, roleMap, projects] = await Promise.all([
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    projectMap(organizationId),
  ]);
  const memberMap = new Map(memberList.map((m) => [m.id, m]));

  const result = assignments
    .filter((a) => a.status === "PENDING" || a.status === "OFFERED")
    .sort((a, b) => cmpDateDesc(a.createdAt, b.createdAt))
    .slice(0, 15)
    .map((a) => {
      const m = memberMap.get(a.crewMemberId);
      const proj = projects.get(a.projectId);
      return {
        ...a,
        crewMember: m ? { id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email ?? null } : null,
        crewRole: a.crewRoleId ? { name: roleMap.get(a.crewRoleId)?.name ?? null } : null,
        project: proj ? { id: proj.id, name: proj.name, projectNumber: proj.projectNumber } : null,
      };
    });

  return serialize(result);
}

export async function getUpcomingShifts() {
  const { organizationId } = await getOrgContext();

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const [shifts, assignments, memberList, roleMap, projects] = await Promise.all([
    getShiftsByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    projectMap(organizationId),
  ]);
  const memberMap = new Map(memberList.map((m) => [m.id, m]));
  const asgMap = new Map(assignments.map((a) => [a.id, a]));

  const result = shifts
    .filter((s) => s.status === "SCHEDULED" && s.date.getTime() >= now.getTime())
    .sort((a, b) => cmpDateAsc(a.date, b.date))
    .slice(0, 10)
    .map((s) => {
      const a = asgMap.get(s.assignmentId);
      const m = a ? memberMap.get(a.crewMemberId) : undefined;
      const proj = a ? projects.get(a.projectId) : undefined;
      return {
        ...s,
        assignment: a
          ? {
              id: a.id,
              crewMember: m ? { firstName: m.firstName, lastName: m.lastName } : null,
              crewRole: a.crewRoleId ? { name: roleMap.get(a.crewRoleId)?.name ?? null } : null,
              project: proj ? { name: proj.name, projectNumber: proj.projectNumber } : null,
            }
          : null,
      };
    });

  return serialize(result);
}
