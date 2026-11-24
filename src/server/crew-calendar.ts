"use server";

import { randomBytes } from "crypto";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { callerSeesCrewPay } from "@/lib/crew-pay-caller";
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

/**
 * The feed's switches only. The `icalToken` is a bearer secret for the public
 * calendar route and is NOT returned here: this action reads with the service
 * identity for any org member, so it would bypass the one member-row boundary.
 * The browser gets the token only from `crew.memberDetail`, through
 * `memberRowRedactor` (the member themself, or `crew:update`, on a user
 * session). The enable/regenerate actions above already require `crew:update`.
 */
export async function getIcalSettings(crewMemberId: string) {
  const { organizationId } = await getOrgContext();

  const member = await getCrewMemberById(crewMemberId);
  if (!member || member.organizationId !== organizationId) throw new Error("Crew member not found");

  return serialize({
    icalEnabled: member.icalEnabled ?? false,
    icalIncludeTentative: member.icalIncludeTentative ?? false,
  });
}

/**
 * Per-member opt-in: also emit PENDING/OFFERED assignments on this member's
 * iCal feed (as STATUS:TENTATIVE), not just CONFIRMED/ACCEPTED. See
 * `/api/crew/calendar/[token]` for the read side.
 */
export async function setIcalIncludeTentative(crewMemberId: string, includeTentative: boolean) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const member = await getCrewMemberById(crewMemberId);
  if (!member || member.organizationId !== organizationId) throw new Error("Crew member not found");

  await (await getConvexClient()).mutation(api.crewMembers.patchMember, {
    id: crewMemberId,
    set: { icalIncludeTentative: includeTentative, updatedAt: Date.now() },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_member",
    entityId: crewMemberId,
    entityName: `${member.firstName} ${member.lastName}`,
    summary: `${includeTentative ? "Enabled" : "Disabled"} tentative assignments on iCal feed for ${member.firstName} ${member.lastName}`,
  });

  return { success: true };
}

// ─── Assignment .ics Download ────────────────────────────────────────────────

/** The row minus the respond token, and minus pay unless the real caller sees it. */
async function browserSafeAssignment<R extends { responseToken: unknown; estimatedCost: unknown; rateOverride: unknown }>(row: R) {
  const { responseToken, estimatedCost, rateOverride, ...rest } = row;
  void responseToken;
  return (await callerSeesCrewPay()) ? { ...rest, estimatedCost, rateOverride } : rest;
}

/**
 * An assignment for an .ics download. Read with the service identity, so it
 * strips here what a browser caller may not hold (B-2 sweep): the single-use
 * `responseToken` (a bearer credential for the accept/decline route) ALWAYS,
 * and the pay fields unless the real caller sees crew pay (`callerSeesCrewPay`).
 */
export async function getAssignmentIcsData(assignmentId: string) {
  const { organizationId } = await requirePermission("crew", "read");

  const row = await getAssignmentById(assignmentId);
  if (!row || row.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }
  const assignment = await browserSafeAssignment(row);

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
