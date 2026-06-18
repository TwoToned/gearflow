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
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getAvailabilityByCrewMemberIds,
  getAssignmentsByOrg,
  selectMemberAvailability,
  selectPlannerAssignments,
  selectPlannerAvailability,
  computeAvailabilityStatus,
  compareAscNullsLast,
  type MappedCrewAssignment,
} from "@/lib/crew-scheduling-read";

// ─── Availability CRUD ──────────────────────────────────────────────────────

export async function getCrewAvailability(
  crewMemberId: string,
  startDate?: string,
  endDate?: string
) {
  const { organizationId } = await getOrgContext();

  const members = await getCrewMembersByOrg(organizationId);
  if (!members.some((m) => m.id === crewMemberId)) throw new Error("Crew member not found");

  const rows = await getAvailabilityByCrewMemberIds([crewMemberId]);
  const range =
    startDate && endDate ? { start: new Date(startDate), end: new Date(endDate) } : null;

  const records = selectMemberAvailability(rows, crewMemberId, range);

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

  // Denormalize organizationId onto the Convex row (not a Prisma column) so the
  // crew planner can subscribe org-wide for reactive availability reads.
  await mirrorCrewAvailabilityCreate({ ...record, organizationId } as unknown as Record<string, unknown>);

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
  const range = { start, end };

  const [allMembers, allAssignments, roleMap, projects] = await Promise.all([
    getCrewMembersByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const members = allMembers
    .filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE")
    .sort(
      (a, b) =>
        compareAscNullsLast(a.lastName, b.lastName) || compareAscNullsLast(a.firstName, b.firstName),
    );

  const assignmentsByMember = new Map<string, MappedCrewAssignment[]>();
  for (const a of allAssignments) {
    const list = assignmentsByMember.get(a.crewMemberId) ?? [];
    list.push(a);
    assignmentsByMember.set(a.crewMemberId, list);
  }

  // Availability for all displayed members, grouped.
  const availabilityRows = await getAvailabilityByCrewMemberIds(members.map((m) => m.id));
  const availabilityByMember = new Map<string, typeof availabilityRows>();
  for (const r of availabilityRows) {
    const list = availabilityByMember.get(r.crewMemberId) ?? [];
    list.push(r);
    availabilityByMember.set(r.crewMemberId, list);
  }

  const result = members.map((m) => {
    const role = m.crewRoleId ? roleMap.get(m.crewRoleId) ?? null : null;
    const assignments = selectPlannerAssignments(assignmentsByMember.get(m.id) ?? [], range).map(
      (a) => {
        const p = projectsById.get(a.projectId) ?? null;
        const aRole = a.crewRoleId ? roleMap.get(a.crewRoleId) ?? null : null;
        return {
          ...a,
          project: p
            ? { id: p.id, name: p.name, projectNumber: p.projectNumber, status: p.status ?? null }
            : null,
          crewRole: aRole ? { name: aRole.name, color: aRole.color ?? null } : null,
        };
      },
    );
    const availability = selectPlannerAvailability(availabilityByMember.get(m.id) ?? [], range);
    return {
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      department: m.department ?? null,
      crewRole: role ? { id: role.id, name: role.name, color: role.color ?? null } : null,
      assignments,
      availability,
    };
  });

  return serialize(result);
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
  const range = { start, end };

  const [blocks, allAssignments, members] = await Promise.all([
    getAvailabilityByCrewMemberIds(crewMemberIds),
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
  ]);

  // Scope availability blocks to members in this org (crewMember.organizationId).
  const orgMemberIds = new Set(members.map((m) => m.id));
  const orgBlocks = blocks.filter((b) => orgMemberIds.has(b.crewMemberId));

  return computeAvailabilityStatus(crewMemberIds, orgBlocks, allAssignments, range);
}
