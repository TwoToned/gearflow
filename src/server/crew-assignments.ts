"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getProjectById } from "@/lib/projects-read";
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

  const assignments = await prisma.crewAssignment.findMany({
    where: { projectId, organizationId },
    include: {
      crewMember: {
        select: {
          id: true, firstName: true, lastName: true,
          email: true, phone: true, image: true,
          defaultDayRate: true, defaultHourlyRate: true,
        },
      },
      crewRole: {
        select: { id: true, name: true, color: true, defaultRate: true, rateType: true },
      },
      service: {
        select: { id: true, title: true, type: true },
      },
      shifts: { orderBy: { date: "asc" } },
      confirmedBy: { select: { id: true, name: true } },
    },
    orderBy: [
      { isProjectManager: "desc" },
      { phase: "asc" },
      { crewMember: { lastName: "asc" } },
    ],
  });

  return serialize(assignments);
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

  const result = await prisma.crewAssignment.aggregate({
    where: {
      projectId,
      organizationId,
      status: { notIn: ["CANCELLED", "DECLINED"] },
    },
    _sum: { estimatedCost: true },
    _count: true,
  });

  return serialize({
    totalLabourCost: result._sum.estimatedCost || 0,
    assignmentCount: result._count,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function getCrewMembersForAssignment(
  projectId: string,
  search?: string,
  dateRange?: { start: string; end: string },
) {
  const { organizationId } = await getOrgContext();

  const where = {
    organizationId,
    isActive: true,
    status: "ACTIVE" as const,
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { department: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const members = await prisma.crewMember.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      image: true,
      department: true,
      defaultDayRate: true,
      defaultHourlyRate: true,
      crewRole: { select: { id: true, name: true } },
      // Assignments on this project
      assignments: {
        where: { projectId },
        select: { id: true, phase: true, status: true, serviceId: true },
      },
    },
    orderBy: { lastName: "asc" },
    take: 50,
  });

  // Cross-project availability check (Arch fix #2)
  if (dateRange) {
    const rangeStart = new Date(dateRange.start);
    const rangeEnd = new Date(dateRange.end);
    const memberIds = members.map((m) => m.id);

    // Single query for all overlapping assignments across all projects
    const conflicts = await prisma.crewAssignment.findMany({
      where: {
        crewMemberId: { in: memberIds },
        projectId: { not: projectId }, // Other projects only
        status: { notIn: ["CANCELLED", "DECLINED"] },
        startDate: { lte: rangeEnd },
        endDate: { gte: rangeStart },
      },
      select: {
        crewMemberId: true,
        projectId: true,
        project: { select: { projectNumber: true, name: true } },
        startDate: true,
        endDate: true,
      },
    });

    // Build conflict map
    const conflictMap = new Map<string, typeof conflicts>();
    for (const c of conflicts) {
      const existing = conflictMap.get(c.crewMemberId) || [];
      existing.push(c);
      conflictMap.set(c.crewMemberId, existing);
    }

    // Also check crew availability blocks
    const unavailable = await prisma.crewAvailability.findMany({
      where: {
        crewMemberId: { in: memberIds },
        type: "UNAVAILABLE",
        startDate: { lte: rangeEnd },
        endDate: { gte: rangeStart },
      },
      select: { crewMemberId: true },
    });
    const unavailableSet = new Set(unavailable.map((u) => u.crewMemberId));

    return serialize(
      members.map((m) => ({
        ...m,
        conflicts: conflictMap.get(m.id) || [],
        isUnavailable: unavailableSet.has(m.id),
      })),
    );
  }

  return serialize(
    members.map((m) => ({
      ...m,
      conflicts: [],
      isUnavailable: false,
    })),
  );
}
