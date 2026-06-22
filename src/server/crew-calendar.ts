"use server";

import { randomBytes } from "crypto";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
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

  const member = await getCrewMemberById(crewMemberId);
  if (!member || member.organizationId !== organizationId) throw new Error("Crew member not found");

  const token = member.icalToken || generateToken();

  // crewMember is Convex-only (Phase C).
  await (await getConvexClient()).mutation(api.crewMembers.patchMember, {
    id: crewMemberId,
    set: { icalEnabled: true, icalToken: token, updatedAt: Date.now() },
  });

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

  return serialize({ icalEnabled: true, icalToken: token });
}

export async function disableIcalFeed(crewMemberId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const member = await getCrewMemberById(crewMemberId);
  if (!member || member.organizationId !== organizationId) throw new Error("Crew member not found");

  await (await getConvexClient()).mutation(api.crewMembers.patchMember, {
    id: crewMemberId,
    set: { icalEnabled: false, updatedAt: Date.now() },
  });

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

  const member = await getCrewMemberById(crewMemberId);
  if (!member || member.organizationId !== organizationId) throw new Error("Crew member not found");

  const token = generateToken();

  await (await getConvexClient()).mutation(api.crewMembers.patchMember, {
    id: crewMemberId,
    set: { icalToken: token, icalEnabled: true, updatedAt: Date.now() },
  });

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

  return serialize({ icalEnabled: true, icalToken: token });
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
