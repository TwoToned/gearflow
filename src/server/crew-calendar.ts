"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { patchCrewMemberInConvex } from "@/lib/crew-mirror";
import { getCrewMemberById, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectById } from "@/lib/projects-read";
import { getLocationById } from "@/lib/locations-read";
import {
  getAssignmentById,
  getShiftsByAssignmentIds,
} from "@/lib/crew-scheduling-read";

// ─── Token Management ────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function enableIcalFeed(crewMemberId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const member = await prisma.crewMember.findUnique({
    where: { id: crewMemberId, organizationId },
    select: { id: true, firstName: true, lastName: true, icalToken: true },
  });
  if (!member) throw new Error("Crew member not found");

  const token = member.icalToken || generateToken();

  const updated = await prisma.crewMember.update({
    where: { id: crewMemberId },
    data: { icalEnabled: true, icalToken: token },
    select: { icalEnabled: true, icalToken: true },
  });
  await patchCrewMemberInConvex(crewMemberId, updated);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_member",
    entityId: crewMemberId,
    entityName: `${member.firstName} ${member.lastName}`,
    summary: `Enabled iCal feed for ${member.firstName} ${member.lastName}`,
  });

  return serialize(updated);
}

export async function disableIcalFeed(crewMemberId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const member = await prisma.crewMember.findUnique({
    where: { id: crewMemberId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!member) throw new Error("Crew member not found");

  await prisma.crewMember.update({
    where: { id: crewMemberId },
    data: { icalEnabled: false },
  });
  await patchCrewMemberInConvex(crewMemberId, { icalEnabled: false });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_member",
    entityId: crewMemberId,
    entityName: `${member.firstName} ${member.lastName}`,
    summary: `Disabled iCal feed for ${member.firstName} ${member.lastName}`,
  });

  return { success: true };
}

export async function regenerateIcalToken(crewMemberId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const member = await prisma.crewMember.findUnique({
    where: { id: crewMemberId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!member) throw new Error("Crew member not found");

  const token = generateToken();

  const updated = await prisma.crewMember.update({
    where: { id: crewMemberId },
    data: { icalToken: token, icalEnabled: true },
    select: { icalEnabled: true, icalToken: true },
  });
  await patchCrewMemberInConvex(crewMemberId, updated);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_member",
    entityId: crewMemberId,
    entityName: `${member.firstName} ${member.lastName}`,
    summary: `Regenerated iCal token for ${member.firstName} ${member.lastName}`,
  });

  return serialize(updated);
}

export async function getIcalSettings(crewMemberId: string) {
  const { organizationId } = await getOrgContext();

  const member = await getCrewMemberById(crewMemberId);
  if (!member || member.organizationId !== organizationId) throw new Error("Crew member not found");

  return serialize({
    icalEnabled: member.icalEnabled ?? false,
    icalToken: member.icalToken ?? null,
  });
}

// ─── Assignment .ics Download ────────────────────────────────────────────────

export async function getAssignmentIcsData(assignmentId: string) {
  const { organizationId } = await getOrgContext();

  const assignment = await getAssignmentById(assignmentId);
  if (!assignment || assignment.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }

  const [member, roleMap, project, shifts] = await Promise.all([
    getCrewMemberById(assignment.crewMemberId),
    getCrewRoleMap(organizationId),
    getProjectById(assignment.projectId),
    getShiftsByAssignmentIds([assignmentId]),
  ]);

  const role = assignment.crewRoleId ? roleMap.get(assignment.crewRoleId) ?? null : null;
  const location = project?.locationId ? await getLocationById(project.locationId) : null;

  const filteredShifts = shifts
    .filter((s) => s.status !== "CANCELLED")
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return serialize({
    ...assignment,
    crewMember: member
      ? { firstName: member.firstName, lastName: member.lastName, email: member.email ?? null }
      : null,
    crewRole: role ? { name: role.name } : null,
    project: project
      ? {
          name: project.name,
          projectNumber: project.projectNumber,
          location: location ? { name: location.name, address: location.address ?? null } : null,
          siteContactName: project.siteContactName ?? null,
          siteContactPhone: project.siteContactPhone ?? null,
        }
      : null,
    shifts: filteredShifts,
  });
}
