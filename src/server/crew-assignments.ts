"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getProjectById } from "@/lib/projects-read";
import { getCrewMembersByOrg, getCrewRolesByOrg } from "@/lib/crew-read";
import { getUserMap } from "@/lib/users-read";
import {
  getAssignmentsByProject,
  getProjectServiceMap,
  getShiftsByOrg,
  type CrewShiftRow,
} from "@/lib/crew-scheduling-read";
import { serialize } from "@/lib/serialize";
import {
  crewAssignmentSchema,
  crewShiftSchema,
  type CrewAssignmentFormValues,
  type CrewShiftFormValues,
} from "@/lib/validations/crew";
import { logActivity } from "@/lib/activity-log";
import { emitIfDiscordEnabled } from "@/lib/services/outbox-service";
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

// ProjectPhase enum declaration order — Postgres sorts enum columns by declared
// order, not alphabetically, so replicate the order for the `phase: "asc"` sort.
const PHASE_ORDER: Record<string, number> = {
  BUMP_IN: 0, EVENT: 1, BUMP_OUT: 2, DELIVERY: 3, PICKUP: 4, SETUP: 5, REHEARSAL: 6, FULL_DURATION: 7,
};
const phaseRank = (p: string | null) => (p == null ? Number.POSITIVE_INFINITY : PHASE_ORDER[p] ?? Number.POSITIVE_INFINITY);

export async function getProjectCrew(projectId: string) {
  const { organizationId } = await getOrgContext();

  // Verify project belongs to org
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) throw new Error("Project not found");

  // Project crew read moved off Prisma to Convex (Phase A). Assignments + shifts
  // from Convex; members/roles from crew-read; service from projectServices;
  // confirmedBy (User) from users-read (auth stays Prisma).
  const [assignments, members, roles, serviceMap, shifts] = await Promise.all([
    getAssignmentsByProject(projectId, organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRolesByOrg(organizationId),
    getProjectServiceMap(organizationId),
    getShiftsByOrg(organizationId),
  ]);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const roleMap = new Map(roles.map((r) => [r.id, r]));
  const userMap = await getUserMap(assignments.map((a) => a.confirmedById));

  const shiftsByAssignment = new Map<string, CrewShiftRow[]>();
  for (const s of shifts) {
    const arr = shiftsByAssignment.get(s.assignmentId);
    if (arr) arr.push(s);
    else shiftsByAssignment.set(s.assignmentId, [s]);
  }
  for (const arr of shiftsByAssignment.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());

  const sorted = [...assignments].sort((a, b) => {
    if (a.isProjectManager !== b.isProjectManager) return a.isProjectManager ? -1 : 1; // desc
    const pr = phaseRank(a.phase) - phaseRank(b.phase); // phase asc (enum order, nulls last)
    if (pr !== 0) return pr;
    const al = memberMap.get(a.crewMemberId)?.lastName ?? "";
    const bl = memberMap.get(b.crewMemberId)?.lastName ?? "";
    return al.localeCompare(bl);
  });

  const result = sorted
    // crewMember is a required relation (Prisma inner-joined it); a missing member
    // means mirror drift, not a real row — drop it (don't fabricate / crash).
    .filter((a) => memberMap.has(a.crewMemberId))
    .map((a) => {
    const m = memberMap.get(a.crewMemberId)!;
    const r = a.crewRoleId ? roleMap.get(a.crewRoleId) : undefined;
    return {
      ...a,
      crewMember: {
        id: m.id, firstName: m.firstName, lastName: m.lastName,
        email: m.email ?? null, phone: m.phone ?? null, image: m.image ?? null,
        defaultDayRate: m.defaultDayRate ?? null, defaultHourlyRate: m.defaultHourlyRate ?? null,
      },
      crewRole: r
        ? { id: r.id, name: r.name, color: r.color ?? null, defaultRate: r.defaultRate ?? null, rateType: r.rateType ?? null }
        : null,
      service: a.serviceId ? serviceMap.get(a.serviceId) ?? null : null,
      shifts: shiftsByAssignment.get(a.id) ?? [],
      confirmedBy: a.confirmedById ? userMap.get(a.confirmedById) ?? null : null,
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

    // Outbox: grant the linked crew member channel access (no-op for unlinked).
    await emitIfDiscordEnabled(tx, {
      organizationId,
      eventType: "crew.assignment.changed",
      payload: {
        projectId,
        crewMemberId: parsed.crewMemberId,
        assignmentId: created.id,
        action: "added",
      },
      dedupeKey: `crew.assignment.changed:${created.id}:added`,
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

    // Outbox: revoke channel access. Emitted in the same txn as the delete so a
    // failed delete never revokes access (and vice-versa).
    await emitIfDiscordEnabled(tx, {
      organizationId,
      eventType: "crew.assignment.changed",
      payload: {
        projectId: assignment.projectId,
        crewMemberId: assignment.crewMemberId,
        assignmentId: id,
        action: "removed",
      },
      dedupeKey: `crew.assignment.changed:${id}:removed`,
    });
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

  // Labour cost read moved to Convex (Phase A): sum estimatedCost + count of
  // non-cancelled/declined assignments, in JS over the Convex rows.
  const assignments = await getAssignmentsByProject(projectId, organizationId);
  const active = assignments.filter((a) => a.status !== "CANCELLED" && a.status !== "DECLINED");
  const totalLabourCost = active.reduce((sum, a) => sum + (a.estimatedCost ?? 0), 0);

  return serialize({
    totalLabourCost,
    assignmentCount: active.length,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * DEFERRED (Phase A): this assignment-picker read stays on Prisma for now. It does
 * a cross-project date-overlap conflict scan + crew-availability check that is
 * more intricate than the leaf reads converted in this pass; convert it with the
 * rest of the crew availability surface. The dual-write mirror keeps it fresh.
 */
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
