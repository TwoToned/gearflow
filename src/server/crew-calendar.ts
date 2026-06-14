"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { patchCrewMemberInConvex } from "@/lib/crew-mirror";

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

  const member = await prisma.crewMember.findUnique({
    where: { id: crewMemberId, organizationId },
    select: { icalEnabled: true, icalToken: true },
  });
  if (!member) throw new Error("Crew member not found");

  return serialize(member);
}

// ─── Assignment .ics Download ────────────────────────────────────────────────

export async function getAssignmentIcsData(assignmentId: string) {
  const { organizationId } = await getOrgContext();

  const assignment = await prisma.crewAssignment.findUnique({
    where: { id: assignmentId, organizationId },
    include: {
      crewMember: { select: { firstName: true, lastName: true, email: true } },
      crewRole: { select: { name: true } },
      project: {
        select: {
          name: true,
          projectNumber: true,
          location: { select: { name: true, address: true } },
          siteContactName: true,
          siteContactPhone: true,
        },
      },
      shifts: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { date: "asc" },
      },
    },
  });

  if (!assignment) throw new Error("Assignment not found");
  return serialize(assignment);
}
