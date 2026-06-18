"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { serialize } from "@/lib/serialize";
import {
  crewAssignmentSchema,
  crewShiftSchema,
  type CrewAssignmentFormValues,
  type CrewShiftFormValues,
} from "@/lib/validations/crew";
import { logActivity } from "@/lib/activity-log";
import {
  syncCrewAssignmentToConvex,
  patchCrewAssignmentInConvex,
  snapshotAssignmentCascade,
  removeCrewAssignmentCascadeFromConvex,
  patchCrewShiftInConvex,
  removeCrewShiftFromConvex,
} from "@/lib/crew-scheduling-mirror";
import {
  getAssignmentsByProject,
  getAssignmentsByOrg,
  getShiftsByAssignmentIds,
  getAvailabilityByCrewMemberIds,
  sortProjectCrew,
  aggregateProjectLabourCost,
  shiftsForAssignmentSortedAsc,
  selectMemberConflicts,
  selectUnavailableMemberIds,
  compareAscNullsLast,
  type MappedCrewAssignment,
} from "@/lib/crew-scheduling-read";

// ─── Rate Cascade ────────────────────────────────────────────────────────────

function resolveRate(
  rateOverride: number | null | undefined,
  rateType: string | null | undefined,
  crewMember: { defaultDayRate: unknown; defaultHourlyRate: unknown },
  crewRole: { defaultRate: unknown; rateType: string | null } | null,
): { rate: number; rateType: string } {
  if (rateOverride != null && rateOverride > 0) {
    return { rate: rateOverride, rateType: rateType || "DAILY" };
  }
  if (crewMember.defaultDayRate != null && Number(crewMember.defaultDayRate) > 0) {
    return { rate: Number(crewMember.defaultDayRate), rateType: "DAILY" };
  }
  if (crewMember.defaultHourlyRate != null && Number(crewMember.defaultHourlyRate) > 0) {
    return { rate: Number(crewMember.defaultHourlyRate), rateType: "HOURLY" };
  }
  if (crewRole?.defaultRate != null && Number(crewRole.defaultRate) > 0) {
    return { rate: Number(crewRole.defaultRate), rateType: crewRole.rateType || "DAILY" };
  }
  return { rate: 0, rateType: "DAILY" };
}

function calculateEstimatedCost(
  rate: number,
  rateType: string,
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  estimatedHours: number | null | undefined,
): number {
  if (rate === 0) return 0;
  if (rateType === "FLAT") return rate;
  if (rateType === "HOURLY") {
    return rate * (estimatedHours || 0);
  }
  // DAILY
  if (startDate && endDate) {
    const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    return rate * days;
  }
  return rate; // Single day fallback
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export async function getProjectCrew(projectId: string) {
  const { organizationId } = await getOrgContext();

  // Verify project belongs to org
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) throw new Error("Project not found");

  const [assignments, members, roleMap] = await Promise.all([
    getAssignmentsByProject(projectId, organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));

  // Shifts for these assignments (one indexed query per assignment id).
  const shifts = await getShiftsByAssignmentIds(assignments.map((a) => a.id));

  // Service join (ProjectService) — read the project's services from Convex.
  const services = await (await getConvexClient()).query(api.projectServices.listByProject, {
    projectId,
    orgId: organizationId,
  });
  const serviceById = new Map(services.map((s) => [s.id, s]));

  // confirmedBy is a Better Auth User — stays Prisma, batched.
  const confirmerIds = [
    ...new Set(assignments.map((a) => a.confirmedById).filter((id): id is string => !!id)),
  ];
  const confirmers = confirmerIds.length
    ? await prisma.user.findMany({ where: { id: { in: confirmerIds } }, select: { id: true, name: true } })
    : [];
  const confirmerById = new Map(confirmers.map((u) => [u.id, u]));

  // crewMember is a required Prisma relation (cascade-deleted with the member), so
  // an assignment always has a present member — a Convex map miss means the member
  // row is gone, which is equivalent to the assignment not existing. Drop those
  // (no Prisma fallback) so the join stays non-null for consumers.
  const sorted = sortProjectCrew(
    assignments.filter((a) => memberById.has(a.crewMemberId)),
    (a) => memberById.get(a.crewMemberId)?.lastName,
  );

  const result = sorted.map((a) => {
    const m = memberById.get(a.crewMemberId)!;
    const role = a.crewRoleId ? roleMap.get(a.crewRoleId) ?? null : null;
    const service = a.serviceId ? serviceById.get(a.serviceId) ?? null : null;
    const confirmer = a.confirmedById ? confirmerById.get(a.confirmedById) ?? null : null;
    return {
      ...a,
      crewMember: {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email ?? null,
        phone: m.phone ?? null,
        image: m.image ?? null,
        defaultDayRate: m.defaultDayRate ?? null,
        defaultHourlyRate: m.defaultHourlyRate ?? null,
      },
      crewRole: role
        ? {
            id: role.id,
            name: role.name,
            color: role.color ?? null,
            defaultRate: role.defaultRate ?? null,
            rateType: role.rateType ?? null,
          }
        : null,
      service: service ? { id: service.id, title: service.title, type: service.type } : null,
      shifts: shiftsForAssignmentSortedAsc(shifts, a.id),
      confirmedBy: confirmer ? { id: confirmer.id, name: confirmer.name ?? null } : null,
    };
  });

  return serialize(result);
}

export async function createAssignment(projectId: string, data: CrewAssignmentFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "create");
  const parsed = crewAssignmentSchema.parse(data);

  // Verify project
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) throw new Error("Project not found");

  // Get crew member and role for rate cascade
  const crewMember = await prisma.crewMember.findUnique({
    where: { id: parsed.crewMemberId, organizationId },
    select: { id: true, firstName: true, lastName: true, defaultDayRate: true, defaultHourlyRate: true },
  });
  if (!crewMember) throw new Error("Crew member not found");

  const crewRole = parsed.crewRoleId
    ? await prisma.crewRole.findUnique({
        where: { id: parsed.crewRoleId, organizationId },
        select: { id: true, name: true, defaultRate: true, rateType: true },
      })
    : null;

  const startDate = parsed.startDate ? new Date(parsed.startDate as unknown as string) : null;
  const endDate = parsed.endDate ? new Date(parsed.endDate as unknown as string) : null;

  const { rate, rateType: resolvedRateType } = resolveRate(
    parsed.rateOverride as number | undefined,
    parsed.rateType || null,
    crewMember,
    crewRole,
  );

  const estimatedCost = calculateEstimatedCost(
    rate, resolvedRateType, startDate, endDate,
    parsed.estimatedHours as number | undefined,
  );

  const assignment = await prisma.$transaction(async (tx) => {
    const created = await tx.crewAssignment.create({
    data: {
      organizationId,
      projectId,
      crewMemberId: parsed.crewMemberId,
      crewRoleId: parsed.crewRoleId || null,
      serviceId: parsed.serviceId || null,
      status: parsed.status,
      phase: parsed.phase || null,
      isProjectManager: parsed.isProjectManager,
      startDate,
      startTime: parsed.startTime || null,
      endDate,
      endTime: parsed.endTime || null,
      rateOverride: parsed.rateOverride ?? null,
      rateType: parsed.rateType || null,
      estimatedHours: parsed.estimatedHours ?? null,
      estimatedCost,
      notes: parsed.notes || null,
      internalNotes: parsed.internalNotes || null,
    },
    });

    return created;
  });

  // Auto-generate shifts if requested
  if (parsed.generateShifts && startDate && endDate) {
    const shifts = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      shifts.push({
        assignmentId: assignment.id,
        date: new Date(current),
        callTime: parsed.startTime || null,
        endTime: parsed.endTime || null,
        status: "SCHEDULED" as const,
      });
      current.setDate(current.getDate() + 1);
    }
    if (shifts.length > 0) {
      await prisma.crewShift.createMany({ data: shifts });
    }
  }

  // Mirror the assignment + any auto-generated shifts to Convex (dual-write).
  await syncCrewAssignmentToConvex(assignment.id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "crew_assignment",
    entityId: assignment.id,
    entityName: `${crewMember.firstName} ${crewMember.lastName}`,
    summary: `Assigned ${crewMember.firstName} ${crewMember.lastName} to ${project.projectNumber}`,
    projectId,
  });

  return serialize(assignment);
}

export async function updateAssignment(id: string, data: CrewAssignmentFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");
  const parsed = crewAssignmentSchema.parse(data);

  const existing = await prisma.crewAssignment.findUnique({
    where: { id, organizationId },
    include: {
      crewMember: { select: { firstName: true, lastName: true, defaultDayRate: true, defaultHourlyRate: true } },
      project: { select: { projectNumber: true } },
    },
  });
  if (!existing) throw new Error("Assignment not found");

  const crewRole = parsed.crewRoleId
    ? await prisma.crewRole.findUnique({
        where: { id: parsed.crewRoleId, organizationId },
        select: { defaultRate: true, rateType: true },
      })
    : null;

  const startDate = parsed.startDate ? new Date(parsed.startDate as unknown as string) : null;
  const endDate = parsed.endDate ? new Date(parsed.endDate as unknown as string) : null;

  const { rate, rateType: resolvedRateType } = resolveRate(
    parsed.rateOverride as number | undefined,
    parsed.rateType || null,
    existing.crewMember,
    crewRole,
  );

  const estimatedCost = calculateEstimatedCost(
    rate, resolvedRateType, startDate, endDate,
    parsed.estimatedHours as number | undefined,
  );

  const updated = await prisma.crewAssignment.update({
    where: { id, organizationId },
    data: {
      crewRoleId: parsed.crewRoleId || null,
      serviceId: parsed.serviceId || null,
      status: parsed.status,
      phase: parsed.phase || null,
      isProjectManager: parsed.isProjectManager,
      startDate,
      startTime: parsed.startTime || null,
      endDate,
      endTime: parsed.endTime || null,
      rateOverride: parsed.rateOverride ?? null,
      rateType: parsed.rateType || null,
      estimatedHours: parsed.estimatedHours ?? null,
      estimatedCost,
      notes: parsed.notes || null,
      internalNotes: parsed.internalNotes || null,
      ...(parsed.status === "CONFIRMED" && !existing.confirmedAt
        ? { confirmedAt: new Date(), confirmedById: userId }
        : {}),
    },
  });

  await patchCrewAssignmentInConvex(id, updated as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_assignment",
    entityId: id,
    entityName: `${existing.crewMember.firstName} ${existing.crewMember.lastName}`,
    summary: `Updated assignment for ${existing.crewMember.firstName} ${existing.crewMember.lastName} on ${existing.project.projectNumber}`,
    projectId: existing.projectId,
  });

  return serialize(updated);
}

export async function deleteAssignment(id: string) {
  const { organizationId, userId, userName } = await requirePermission("crew", "delete");

  const assignment = await prisma.crewAssignment.findUnique({
    where: { id, organizationId },
    include: {
      crewMember: { select: { firstName: true, lastName: true } },
      project: { select: { projectNumber: true } },
    },
  });
  if (!assignment) throw new Error("Assignment not found");

  // Capture the cascade (shifts + time entries) before the delete removes them.
  const cascade = await snapshotAssignmentCascade(id);

  await prisma.$transaction(async (tx) => {
    await tx.crewAssignment.delete({ where: { id, organizationId } });
  });

  await removeCrewAssignmentCascadeFromConvex(cascade);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "crew_assignment",
    entityId: id,
    entityName: `${assignment.crewMember.firstName} ${assignment.crewMember.lastName}`,
    summary: `Removed ${assignment.crewMember.firstName} ${assignment.crewMember.lastName} from ${assignment.project.projectNumber}`,
    projectId: assignment.projectId,
  });

  return { success: true };
}

export async function updateAssignmentStatus(id: string, status: string) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");

  const assignment = await prisma.crewAssignment.findUnique({
    where: { id, organizationId },
    include: {
      crewMember: { select: { firstName: true, lastName: true } },
      project: { select: { projectNumber: true } },
    },
  });
  if (!assignment) throw new Error("Assignment not found");

  const updateData: Record<string, unknown> = { status };
  if (status === "CONFIRMED" && !assignment.confirmedAt) {
    updateData.confirmedAt = new Date();
    updateData.confirmedById = userId;
  }

  const updated = await prisma.crewAssignment.update({
    where: { id, organizationId },
    data: updateData,
  });

  await patchCrewAssignmentInConvex(id, updated as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "STATUS_CHANGE",
    entityType: "crew_assignment",
    entityId: id,
    entityName: `${assignment.crewMember.firstName} ${assignment.crewMember.lastName}`,
    summary: `Changed ${assignment.crewMember.firstName} ${assignment.crewMember.lastName} status to ${status} on ${assignment.project.projectNumber}`,
    projectId: assignment.projectId,
  });

  return serialize(updated);
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

export async function generateShifts(assignmentId: string) {
  const { organizationId } = await requirePermission("crew", "update");

  const assignment = await prisma.crewAssignment.findUnique({
    where: { id: assignmentId, organizationId },
  });
  if (!assignment) throw new Error("Assignment not found");
  if (!assignment.startDate || !assignment.endDate) {
    throw new Error("Assignment must have start and end dates to generate shifts");
  }

  // Delete existing SCHEDULED shifts (preserve completed ones). Capture their ids
  // first so we can drop the regenerated-orphaned rows from Convex.
  const oldShiftIds = (
    await prisma.crewShift.findMany({
      where: { assignmentId, status: "SCHEDULED" },
      select: { id: true },
    })
  ).map((s) => s.id);
  await prisma.crewShift.deleteMany({
    where: { assignmentId, status: "SCHEDULED" },
  });

  const shifts = [];
  const current = new Date(assignment.startDate);
  const end = new Date(assignment.endDate);
  while (current <= end) {
    shifts.push({
      assignmentId,
      date: new Date(current),
      callTime: assignment.startTime || null,
      endTime: assignment.endTime || null,
      status: "SCHEDULED" as const,
    });
    current.setDate(current.getDate() + 1);
  }

  if (shifts.length > 0) {
    await prisma.crewShift.createMany({ data: shifts });
  }

  // Drop the deleted-and-regenerated shifts, then mirror the fresh ones.
  for (const sid of oldShiftIds) await removeCrewShiftFromConvex(sid);
  await syncCrewAssignmentToConvex(assignmentId);

  return serialize({ count: shifts.length });
}

export async function updateShift(shiftId: string, data: CrewShiftFormValues) {
  const { organizationId } = await requirePermission("crew", "update");
  const parsed = crewShiftSchema.parse(data);

  const shift = await prisma.crewShift.findUnique({
    where: { id: shiftId },
    include: { assignment: { select: { organizationId: true } } },
  });
  if (!shift || shift.assignment.organizationId !== organizationId) {
    throw new Error("Shift not found");
  }

  const updated = await prisma.crewShift.update({
    where: { id: shiftId },
    data: {
      date: new Date(parsed.date),
      callTime: parsed.callTime || null,
      endTime: parsed.endTime || null,
      breakMinutes: parsed.breakMinutes ?? null,
      location: parsed.location || null,
      notes: parsed.notes || null,
      status: parsed.status,
    },
  });

  await patchCrewShiftInConvex(shiftId, updated as unknown as Record<string, unknown>);

  return serialize(updated);
}

export async function deleteShift(shiftId: string) {
  const { organizationId } = await requirePermission("crew", "update");

  const shift = await prisma.crewShift.findUnique({
    where: { id: shiftId },
    include: { assignment: { select: { organizationId: true } } },
  });
  if (!shift || shift.assignment.organizationId !== organizationId) {
    throw new Error("Shift not found");
  }

  await prisma.crewShift.delete({ where: { id: shiftId } });
  await removeCrewShiftFromConvex(shiftId);
  return { success: true };
}

// ─── Labour Cost ─────────────────────────────────────────────────────────────

export async function getProjectLabourCost(projectId: string) {
  const { organizationId } = await getOrgContext();

  const assignments = await getAssignmentsByProject(projectId, organizationId);
  return serialize(aggregateProjectLabourCost(assignments));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function getCrewMembersForAssignment(
  projectId: string,
  search?: string,
  dateRange?: { start: string; end: string },
) {
  const { organizationId } = await getOrgContext();

  const [allMembers, allAssignments, roleMap, projects] = await Promise.all([
    getCrewMembersByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const needle = search?.trim().toLowerCase();
  const members = allMembers
    .filter((m) => (m.isActive ?? true) && (m.status ?? "ACTIVE") === "ACTIVE")
    .filter((m) => {
      if (!needle) return true;
      return (
        m.firstName.toLowerCase().includes(needle) ||
        m.lastName.toLowerCase().includes(needle) ||
        (m.email ?? "").toLowerCase().includes(needle) ||
        (m.department ?? "").toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => compareAscNullsLast(a.lastName, b.lastName))
    .slice(0, 50);

  // Assignments on THIS project, grouped by member (the nested `assignments` sublist).
  const projectAssignmentsByMember = new Map<string, MappedCrewAssignment[]>();
  for (const a of allAssignments) {
    if (a.projectId !== projectId) continue;
    const list = projectAssignmentsByMember.get(a.crewMemberId) ?? [];
    list.push(a);
    projectAssignmentsByMember.set(a.crewMemberId, list);
  }

  const baseShape = (m: (typeof members)[number]) => {
    const role = m.crewRoleId ? roleMap.get(m.crewRoleId) ?? null : null;
    return {
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      email: m.email ?? null,
      phone: m.phone ?? null,
      image: m.image ?? null,
      department: m.department ?? null,
      defaultDayRate: m.defaultDayRate ?? null,
      defaultHourlyRate: m.defaultHourlyRate ?? null,
      crewRole: role ? { id: role.id, name: role.name } : null,
      assignments: (projectAssignmentsByMember.get(m.id) ?? []).map((a) => ({
        id: a.id,
        phase: a.phase,
        status: a.status,
        serviceId: a.serviceId,
      })),
    };
  };

  // Cross-project availability check (Arch fix #2)
  if (dateRange) {
    const rangeStart = new Date(dateRange.start);
    const rangeEnd = new Date(dateRange.end);
    const range = { start: rangeStart, end: rangeEnd };
    const memberIds = members.map((m) => m.id);

    const availability = await getAvailabilityByCrewMemberIds(memberIds);
    const unavailableSet = selectUnavailableMemberIds(availability, range);

    return serialize(
      members.map((m) => {
        const conflicts = selectMemberConflicts(allAssignments, m.id, projectId, range).map((c) => {
          const p = projectsById.get(c.projectId) ?? null;
          return {
            crewMemberId: c.crewMemberId,
            projectId: c.projectId,
            project: p ? { projectNumber: p.projectNumber, name: p.name } : null,
            startDate: c.startDate,
            endDate: c.endDate,
          };
        });
        return {
          ...baseShape(m),
          conflicts,
          isUnavailable: unavailableSet.has(m.id),
        };
      }),
    );
  }

  return serialize(
    members.map((m) => ({
      ...baseShape(m),
      conflicts: [] as never[],
      isUnavailable: false,
    })),
  );
}
