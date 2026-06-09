"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  crewAvailabilitySchema,
  type CrewAvailabilityFormValues,
} from "@/lib/validations/crew";
import { logActivity } from "@/lib/activity-log";
import {
  mirrorCrewAvailabilityCreate,
  removeCrewAvailabilityFromConvex,
} from "@/lib/crew-scheduling-mirror";

// ─── Availability CRUD ──────────────────────────────────────────────────────

export async function getCrewAvailability(
  crewMemberId: string,
  startDate?: string,
  endDate?: string
) {
  const { organizationId } = await getOrgContext();

  const member = await prisma.crewMember.findUnique({
    where: { id: crewMemberId, organizationId },
    select: { id: true },
  });
  if (!member) throw new Error("Crew member not found");

  const where: Record<string, unknown> = { crewMemberId };
  if (startDate && endDate) {
    // Overlapping range: availability.startDate <= endDate AND availability.endDate >= startDate
    where.startDate = { lte: new Date(endDate) };
    where.endDate = { gte: new Date(startDate) };
  }

  const records = await prisma.crewAvailability.findMany({
    where,
    orderBy: { startDate: "asc" },
  });

  return serialize(records);
}

export async function addAvailability(data: CrewAvailabilityFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );
  const parsed = crewAvailabilitySchema.parse(data);

  const member = await prisma.crewMember.findUnique({
    where: { id: parsed.crewMemberId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!member) throw new Error("Crew member not found");

  const record = await prisma.crewAvailability.create({
    data: {
      crewMemberId: parsed.crewMemberId,
      startDate: new Date(parsed.startDate as unknown as string),
      endDate: new Date(parsed.endDate as unknown as string),
      type: parsed.type,
      reason: parsed.reason || null,
      isAllDay: parsed.isAllDay,
      startTime: parsed.startTime || null,
      endTime: parsed.endTime || null,
    },
  });

  await mirrorCrewAvailabilityCreate(record as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_member",
    entityId: parsed.crewMemberId,
    entityName: `${member.firstName} ${member.lastName}`,
    summary: `Added ${parsed.type.toLowerCase()} availability for ${member.firstName} ${member.lastName}`,
  });

  return serialize(record);
}

export async function removeAvailability(id: string) {
  const { organizationId } = await requirePermission("crew", "update");

  const record = await prisma.crewAvailability.findUnique({
    where: { id },
    include: {
      crewMember: {
        select: { organizationId: true },
      },
    },
  });
  if (!record || record.crewMember.organizationId !== organizationId) {
    throw new Error("Availability record not found");
  }

  await prisma.crewAvailability.delete({ where: { id } });
  await removeCrewAvailabilityFromConvex(id);
  return { success: true };
}

// ─── Conflict Detection ─────────────────────────────────────────────────────

export interface CrewConflict {
  type: "availability" | "assignment";
  severity: "hard" | "soft"; // hard = unavailable, soft = tentative or double-booked
  label: string;
  startDate: string;
  endDate: string;
}

export async function checkCrewConflicts(
  crewMemberId: string,
  startDate: string,
  endDate: string,
  excludeAssignmentId?: string
): Promise<CrewConflict[]> {
  const { organizationId } = await getOrgContext();

  const start = new Date(startDate);
  const end = new Date(endDate);
  const conflicts: CrewConflict[] = [];

  // Check availability blocks
  const blocks = await prisma.crewAvailability.findMany({
    where: {
      crewMemberId,
      startDate: { lte: end },
      endDate: { gte: start },
      crewMember: { organizationId },
    },
  });

  for (const b of blocks) {
    conflicts.push({
      type: "availability",
      severity: b.type === "UNAVAILABLE" ? "hard" : "soft",
      label:
        b.type === "UNAVAILABLE"
          ? `Unavailable${b.reason ? `: ${b.reason}` : ""}`
          : b.type === "TENTATIVE"
            ? `Tentative${b.reason ? `: ${b.reason}` : ""}`
            : `Preferred${b.reason ? `: ${b.reason}` : ""}`,
      startDate: b.startDate.toISOString(),
      endDate: b.endDate.toISOString(),
    });
  }

  // Check overlapping assignments (double-booking)
  const overlapping = await prisma.crewAssignment.findMany({
    where: {
      crewMemberId,
      organizationId,
      status: { notIn: ["CANCELLED", "DECLINED"] },
      startDate: { lte: end },
      endDate: { gte: start },
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
    },
    include: {
      project: { select: { name: true, projectNumber: true } },
    },
  });

  for (const a of overlapping) {
    conflicts.push({
      type: "assignment",
      severity: "soft",
      label: `Already on ${a.project.projectNumber} - ${a.project.name}`,
      startDate: a.startDate?.toISOString() || start.toISOString(),
      endDate: a.endDate?.toISOString() || end.toISOString(),
    });
  }

  return conflicts;
}

// ─── Planner Data ───────────────────────────────────────────────────────────

export async function getCrewPlannerData(startDate: string, endDate: string) {
  const { organizationId } = await getOrgContext();

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Get all active crew members with their assignments and availability in range
  const members = await prisma.crewMember.findMany({
    where: { organizationId, isActive: true, status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      department: true,
      crewRole: { select: { id: true, name: true, color: true } },
      assignments: {
        where: {
          status: { notIn: ["CANCELLED", "DECLINED"] },
          OR: [
            { startDate: { lte: end }, endDate: { gte: start } },
            { startDate: null },
          ],
        },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              projectNumber: true,
              status: true,
            },
          },
          crewRole: { select: { name: true, color: true } },
        },
      },
      availability: {
        where: {
          startDate: { lte: end },
          endDate: { gte: start },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return serialize(members);
}

// ─── Availability Status for Crew List ──────────────────────────────────────

export async function getCrewAvailabilityStatus(
  crewMemberIds: string[],
  startDate: string,
  endDate: string
) {
  const { organizationId } = await getOrgContext();

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Get availability blocks for all requested members
  const blocks = await prisma.crewAvailability.findMany({
    where: {
      crewMemberId: { in: crewMemberIds },
      startDate: { lte: end },
      endDate: { gte: start },
      crewMember: { organizationId },
    },
    select: { crewMemberId: true, type: true },
  });

  // Get overlapping assignments
  const assignments = await prisma.crewAssignment.findMany({
    where: {
      crewMemberId: { in: crewMemberIds },
      organizationId,
      status: { notIn: ["CANCELLED", "DECLINED"] },
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { crewMemberId: true },
  });

  // Build status map: "available" | "tentative" | "unavailable" | "busy"
  const statusMap: Record<
    string,
    "available" | "tentative" | "unavailable" | "busy"
  > = {};

  for (const id of crewMemberIds) {
    statusMap[id] = "available";
  }

  // Check blocks
  for (const b of blocks) {
    if (b.type === "UNAVAILABLE") {
      statusMap[b.crewMemberId] = "unavailable";
    } else if (
      b.type === "TENTATIVE" &&
      statusMap[b.crewMemberId] === "available"
    ) {
      statusMap[b.crewMemberId] = "tentative";
    }
  }

  // Check assignments (don't override unavailable)
  for (const a of assignments) {
    if (statusMap[a.crewMemberId] === "available") {
      statusMap[a.crewMemberId] = "busy";
    }
  }

  return statusMap;
}
