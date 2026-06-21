"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getAssignmentsByOrg,
  getTimeEntriesByOrg,
  getShiftsByAssignmentIds,
  countActiveConfirmedAssignments,
  countPendingOffers,
  countSubmittedTimeEntries,
  sumHoursThisWeek,
  selectActiveAssignmentsSummary,
  selectPendingOffers,
  selectPendingTimeEntries,
  selectMemberPickerAssignments,
  selectUpcomingShifts,
  compareAscNullsLast,
  type MappedCrewAssignment,
} from "@/lib/crew-scheduling-read";

/** Project mini-shape used for the dashboard joins (replaces Prisma `include: { project }`). */
function projectMini(
  projectsById: Map<string, { id: string; name: string; projectNumber: string; status?: string }>,
  projectId: string,
) {
  const p = projectsById.get(projectId);
  return p ? { id: p.id, name: p.name, projectNumber: p.projectNumber, status: p.status ?? null } : null;
}

/** Attach project + crewRole onto an assignment, matching the old include shape. */
function attachAssignmentJoins(
  a: MappedCrewAssignment,
  projectsById: Map<string, { id: string; name: string; projectNumber: string; status?: string }>,
  roleMap: Map<string, { id: string; name: string }>,
) {
  const project = projectMini(projectsById, a.projectId);
  const crewRole = a.crewRoleId ? roleMap.get(a.crewRoleId) ?? null : null;
  return {
    ...a,
    project: project ? { id: project.id, name: project.name, projectNumber: project.projectNumber } : null,
    crewRole: crewRole ? { id: crewRole.id, name: crewRole.name } : null,
  };
}

export async function getCrewPickerList() {
  const { organizationId } = await getOrgContext();

  const [members, assignments, roleMap, projects] = await Promise.all([
    getCrewMembersByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const activeMembers = members
    .filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE")
    .sort(
      (a, b) =>
        compareAscNullsLast(a.firstName, b.firstName) || compareAscNullsLast(a.lastName, b.lastName),
    );

  const assignmentsByMember = new Map<string, MappedCrewAssignment[]>();
  for (const a of assignments) {
    const list = assignmentsByMember.get(a.crewMemberId) ?? [];
    list.push(a);
    assignmentsByMember.set(a.crewMemberId, list);
  }

  const result = activeMembers.map((m) => {
    const role = m.crewRoleId ? roleMap.get(m.crewRoleId) ?? null : null;
    const memberAssignments = selectMemberPickerAssignments(assignmentsByMember.get(m.id) ?? []);
    return {
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      department: m.department ?? null,
      crewRole: role ? { name: role.name } : null,
      assignments: memberAssignments.map((a) => attachAssignmentJoins(a, projectsById, roleMap)),
    };
  });

  return serialize(result);
}

export async function getCrewDashboardStats() {
  const { organizationId } = await getOrgContext();

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [members, assignments, timeEntries] = await Promise.all([
    getCrewMembersByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getTimeEntriesByOrg(organizationId),
  ]);

  const totalActive = members.filter(
    (m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE",
  ).length;

  return {
    totalActive,
    activeAssignments: countActiveConfirmedAssignments(assignments, now),
    pendingOffers: countPendingOffers(assignments),
    submittedTime: countSubmittedTimeEntries(timeEntries),
    hoursThisWeek: sumHoursThisWeek(timeEntries, weekAgo),
  };
}

export async function getPendingTimeEntries() {
  const { organizationId } = await getOrgContext();

  const [timeEntries, assignments, members, roleMap, projects] = await Promise.all([
    getTimeEntriesByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const selected = selectPendingTimeEntries(timeEntries);

  const result = selected.map((e) => {
    const member = memberById.get(e.crewMemberId) ?? null;
    const assignment = e.assignmentId ? assignmentById.get(e.assignmentId) ?? null : null;
    const project = assignment ? projectMini(projectsById, assignment.projectId) : null;
    const role = assignment?.crewRoleId ? roleMap.get(assignment.crewRoleId) ?? null : null;
    return {
      ...e,
      crewMember: member ? { firstName: member.firstName, lastName: member.lastName } : null,
      assignment: assignment
        ? {
            ...assignment,
            project: project ? { name: project.name, projectNumber: project.projectNumber } : null,
            crewRole: role ? { name: role.name } : null,
          }
        : null,
    };
  });

  return serialize(result);
}

export async function getActiveAssignmentsSummary() {
  const { organizationId } = await getOrgContext();

  const now = new Date();

  const [assignments, members, roleMap, projects] = await Promise.all([
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const selected = selectActiveAssignmentsSummary(assignments, now);

  const result = selected.map((a) => {
    const member = memberById.get(a.crewMemberId) ?? null;
    const role = a.crewRoleId ? roleMap.get(a.crewRoleId) ?? null : null;
    const project = projectMini(projectsById, a.projectId);
    return {
      ...a,
      crewMember: member ? { id: member.id, firstName: member.firstName, lastName: member.lastName } : null,
      crewRole: role ? { name: role.name } : null,
      project: project
        ? { id: project.id, name: project.name, projectNumber: project.projectNumber, status: project.status }
        : null,
    };
  });

  return serialize(result);
}

export async function getPendingOffers() {
  const { organizationId } = await getOrgContext();

  const [assignments, members, roleMap, projects] = await Promise.all([
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const selected = selectPendingOffers(assignments);

  const result = selected.map((a) => {
    const member = memberById.get(a.crewMemberId) ?? null;
    const role = a.crewRoleId ? roleMap.get(a.crewRoleId) ?? null : null;
    const project = projectMini(projectsById, a.projectId);
    return {
      ...a,
      crewMember: member
        ? { id: member.id, firstName: member.firstName, lastName: member.lastName, email: member.email ?? null }
        : null,
      crewRole: role ? { name: role.name } : null,
      project: project ? { id: project.id, name: project.name, projectNumber: project.projectNumber } : null,
    };
  });

  return serialize(result);
}

export async function getUpcomingShifts() {
  const { organizationId } = await getOrgContext();

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const [assignments, members, roleMap, projects] = await Promise.all([
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const orgAssignmentIds = new Set(assignments.map((a) => a.id));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const shifts = await getShiftsByAssignmentIds([...orgAssignmentIds]);
  const selected = selectUpcomingShifts(shifts, orgAssignmentIds, now);

  const result = selected.map((s) => {
    const assignment = assignmentById.get(s.assignmentId) ?? null;
    const member = assignment ? memberById.get(assignment.crewMemberId) ?? null : null;
    const role = assignment?.crewRoleId ? roleMap.get(assignment.crewRoleId) ?? null : null;
    const project = assignment ? projectMini(projectsById, assignment.projectId) : null;
    return {
      ...s,
      assignment: assignment
        ? {
            ...assignment,
            crewMember: member ? { firstName: member.firstName, lastName: member.lastName } : null,
            crewRole: role ? { name: role.name } : null,
            project: project ? { name: project.name, projectNumber: project.projectNumber } : null,
          }
        : null,
    };
  });

  return serialize(result);
}
