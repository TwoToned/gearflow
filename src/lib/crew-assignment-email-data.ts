import "server-only";

import { prisma } from "@/lib/prisma";
import { getLocationById } from "@/lib/locations-read";
import { getAssignmentById } from "@/lib/crew-scheduling-read";
import { getCrewMemberById, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectByIdMapped } from "@/lib/projects-read";

/**
 * The assignment (with its crew member, role and project) and the email
 * fields every crew email renders from. Read with the service identity, so
 * the full row — `responseToken` (the accept/decline bearer) and the pay
 * fields included — is in hand. That is why this is a PLAIN server module, not
 * a `"use server"` export: an exported server action is callable from any
 * browser session, and this one did no authz of its own (B-2 sweep). Every
 * caller (the crew-communication actions, which gate on `requirePermission`
 * first; the cron nudges; the public respond route) imports it from here.
 */
export async function buildAssignmentEmailData(assignmentId: string) {
  // crewAssignment / crewMember / crewRole and project are all dual-written /
  // Convex-only — re-source the assignment + its crew member, role and project
  // from Convex (the old Prisma `crewAssignment.findUnique` reads empty). The
  // organization name stays Prisma (Better-Auth-adjacent org table, kept).
  const assignmentRow = await getAssignmentById(assignmentId);
  if (!assignmentRow) throw new Error("Assignment not found");

  const [crewMember, project, roleMap, org] = await Promise.all([
    getCrewMemberById(assignmentRow.crewMemberId),
    getProjectByIdMapped(assignmentRow.projectId, assignmentRow.organizationId),
    assignmentRow.crewRoleId ? getCrewRoleMap(assignmentRow.organizationId) : Promise.resolve(null),
    prisma.organization.findUnique({
      where: { id: assignmentRow.organizationId },
      select: { name: true },
    }),
  ]);
  if (!crewMember) throw new Error("Assignment not found");
  if (!project) throw new Error("Assignment not found");

  const roleName = assignmentRow.crewRoleId
    ? roleMap?.get(assignmentRow.crewRoleId)?.name ?? null
    : null;

  // Location FK was dropped (Phase B); resolve the project's location from the
  // Convex mirror (replaces the old nested `project.location` select).
  const location = project.locationId
    ? await getLocationById(project.locationId)
    : null;

  // Reconstruct the nested shape the senders consume (assignment.crewMember /
  // .project / .organizationId).
  const assignment = {
    ...assignmentRow,
    crewMember: {
      firstName: crewMember.firstName,
      lastName: crewMember.lastName,
      email: crewMember.email ?? null,
    },
    crewRole: roleName ? { name: roleName } : null,
    project: {
      name: project.name,
      projectNumber: project.projectNumber,
      siteContactName: project.siteContactName,
      siteContactPhone: project.siteContactPhone,
    },
    organization: org ? { name: org.name } : null,
  };

  return {
    assignment,
    emailData: {
      crewFirstName: crewMember.firstName,
      projectName: project.name,
      projectNumber: project.projectNumber,
      roleName,
      phase: assignmentRow.phase,
      startDate: assignmentRow.startDate?.toISOString() || null,
      endDate: assignmentRow.endDate?.toISOString() || null,
      startTime: assignmentRow.startTime,
      endTime: assignmentRow.endTime,
      locationName: location?.name || null,
      locationAddress: location?.address || null,
      siteContactName: project.siteContactName,
      siteContactPhone: project.siteContactPhone,
      notes: assignmentRow.notes,
      orgName: org?.name || "RVLT Flow",
    },
  };
}
