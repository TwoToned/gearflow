"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { getProjectById, getProjectsByOrg } from "@/lib/projects-read";
import { getCrewMembersByOrg, getCrewRoleMap, getCrewMemberById, getCrewRoleById } from "@/lib/crew-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { createId } from "@paralleldrive/cuid2";
import { serialize } from "@/lib/serialize";
import {
  crewAssignmentSchema,
  crewShiftSchema,
  type CrewAssignmentFormValues,
  type CrewShiftFormValues,
} from "@/lib/validations/crew";
import { logActivity } from "@/lib/activity-log";
import {
  getAssignmentById,
  getAssignmentsByProject,
  getAssignmentsByOrg,
  getShiftsByAssignmentIds,
  getAvailabilityByCrewMemberIds,
  mapShift,
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
  crewMember: { defaultDayRate?: unknown; defaultHourlyRate?: unknown },
  crewRole: { defaultRate?: unknown; rateType?: string | null } | null,
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

  // Get crew member and role for rate cascade (crew_member / crew_role are
  // Convex-only — read the doc + verify org).
  const crewMemberDoc = await getCrewMemberById(parsed.crewMemberId);
  const crewMember = crewMemberDoc && crewMemberDoc.organizationId === organizationId ? crewMemberDoc : null;
  if (!crewMember) throw new Error("Crew member not found");

  const crewRoleDoc = parsed.crewRoleId ? await getCrewRoleById(parsed.crewRoleId) : null;
  const crewRole =
    crewRoleDoc && crewRoleDoc.organizationId === organizationId
      ? { id: crewRoleDoc.id, name: crewRoleDoc.name, defaultRate: crewRoleDoc.defaultRate ?? null, rateType: crewRoleDoc.rateType ?? null }
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

  const convex = await getConvexClient();
  const id = createId();
  const now = Date.now();

  // Convex-only write: cuid minted here, dates → epoch-ms, nulls omitted.
  await convex.mutation(api.crewAssignments.create, {
    id,
    organizationId,
    projectId,
    crewMemberId: parsed.crewMemberId,
    ...(parsed.crewRoleId ? { crewRoleId: parsed.crewRoleId } : {}),
    ...(parsed.serviceId ? { serviceId: parsed.serviceId } : {}),
    status: parsed.status,
    ...(parsed.phase ? { phase: parsed.phase } : {}),
    isProjectManager: parsed.isProjectManager,
    ...(startDate ? { startDate: startDate.getTime() } : {}),
    ...(parsed.startTime ? { startTime: parsed.startTime } : {}),
    ...(endDate ? { endDate: endDate.getTime() } : {}),
    ...(parsed.endTime ? { endTime: parsed.endTime } : {}),
    ...(parsed.rateOverride != null ? { rateOverride: parsed.rateOverride } : {}),
    ...(parsed.rateType ? { rateType: parsed.rateType } : {}),
    ...(parsed.estimatedHours != null ? { estimatedHours: parsed.estimatedHours } : {}),
    estimatedCost,
    ...(parsed.notes ? { notes: parsed.notes } : {}),
    ...(parsed.internalNotes ? { internalNotes: parsed.internalNotes } : {}),
    createdAt: now,
    updatedAt: now,
  });

  // Auto-generate shifts if requested (one Convex shift per day in [start,end]).
  if (parsed.generateShifts && startDate && endDate) {
    const current = new Date(startDate);
    while (current <= endDate) {
      await convex.mutation(api.crewShifts.create, {
        id: createId(),
        assignmentId: id,
        date: current.getTime(),
        ...(parsed.startTime ? { callTime: parsed.startTime } : {}),
        ...(parsed.endTime ? { endTime: parsed.endTime } : {}),
        status: "SCHEDULED",
      });
      current.setDate(current.getDate() + 1);
    }
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "crew_assignment",
    entityId: id,
    entityName: `${crewMember.firstName} ${crewMember.lastName}`,
    summary: `Assigned ${crewMember.firstName} ${crewMember.lastName} to ${project.projectNumber}`,
    projectId,
  });

  const created = await getAssignmentById(id);
  return serialize(created);
}

export async function updateAssignment(id: string, data: CrewAssignmentFormValues) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");
  const parsed = crewAssignmentSchema.parse(data);

  const existing = await getAssignmentById(id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }

  // crewMember (rate cascade inputs) + project (audit label) are Convex-only —
  // read the docs; the assignment WRITE inverts to Convex.
  const crewMemberDoc = await getCrewMemberById(existing.crewMemberId);
  const crewMember = crewMemberDoc && crewMemberDoc.organizationId === organizationId ? crewMemberDoc : null;
  if (!crewMember) throw new Error("Crew member not found");

  const project = await getProjectById(existing.projectId);

  const crewRoleDoc = parsed.crewRoleId ? await getCrewRoleById(parsed.crewRoleId) : null;
  const crewRole =
    crewRoleDoc && crewRoleDoc.organizationId === organizationId
      ? { defaultRate: crewRoleDoc.defaultRate ?? null, rateType: crewRoleDoc.rateType ?? null }
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

  // CONFIRMED status-machine stamp (only on the PENDING/OFFERED → CONFIRMED edge).
  const stampConfirmed = parsed.status === "CONFIRMED" && !existing.confirmedAt;

  // Build set/clear: fields the input nulls go in `clear` (Convex optionals can't
  // hold null), everything present goes in `set`.
  const set: Record<string, unknown> = {
    status: parsed.status,
    isProjectManager: parsed.isProjectManager,
    estimatedCost,
    updatedAt: Date.now(),
  };
  const clear: string[] = [];

  if (parsed.crewRoleId) set.crewRoleId = parsed.crewRoleId;
  else clear.push("crewRoleId");
  if (parsed.serviceId) set.serviceId = parsed.serviceId;
  else clear.push("serviceId");
  if (parsed.phase) set.phase = parsed.phase;
  else clear.push("phase");
  if (startDate) set.startDate = startDate.getTime();
  else clear.push("startDate");
  if (parsed.startTime) set.startTime = parsed.startTime;
  else clear.push("startTime");
  if (endDate) set.endDate = endDate.getTime();
  else clear.push("endDate");
  if (parsed.endTime) set.endTime = parsed.endTime;
  else clear.push("endTime");
  if (parsed.rateOverride != null) set.rateOverride = parsed.rateOverride;
  else clear.push("rateOverride");
  if (parsed.rateType) set.rateType = parsed.rateType;
  else clear.push("rateType");
  if (parsed.estimatedHours != null) set.estimatedHours = parsed.estimatedHours;
  else clear.push("estimatedHours");
  if (parsed.notes) set.notes = parsed.notes;
  else clear.push("notes");
  if (parsed.internalNotes) set.internalNotes = parsed.internalNotes;
  else clear.push("internalNotes");
  if (stampConfirmed) {
    set.confirmedAt = Date.now();
    set.confirmedById = userId;
  }

  const convex = await getConvexClient();
  await convex.mutation(api.crewAssignments.patchAssignment, { id, set, clear });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_assignment",
    entityId: id,
    entityName: `${crewMember.firstName} ${crewMember.lastName}`,
    summary: `Updated assignment for ${crewMember.firstName} ${crewMember.lastName} on ${project?.projectNumber ?? ""}`,
    projectId: existing.projectId,
  });

  const updated = await getAssignmentById(id);
  return serialize(updated);
}

export async function deleteAssignment(id: string) {
  const { organizationId, userId, userName } = await requirePermission("crew", "delete");

  const assignment = await getAssignmentById(id);
  if (!assignment || assignment.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }

  const crewMemberDoc = await getCrewMemberById(assignment.crewMemberId);
  const crewMember = crewMemberDoc && crewMemberDoc.organizationId === organizationId ? crewMemberDoc : null;
  const project = await getProjectById(assignment.projectId);

  // Convex-only cascade delete: assignment + its shifts + its linked time entries.
  const convex = await getConvexClient();
  await convex.mutation(api.crewAssignments.deleteCascade, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "crew_assignment",
    entityId: id,
    entityName: `${crewMember?.firstName ?? ""} ${crewMember?.lastName ?? ""}`.trim(),
    summary: `Removed ${crewMember?.firstName ?? ""} ${crewMember?.lastName ?? ""} from ${project?.projectNumber ?? ""}`,
    projectId: assignment.projectId,
  });

  return { success: true };
}

/**
 * Bulk-remove crew assignments in one server round-trip. Loops the same
 * Convex cascade delete (assignment + shifts + linked time entries) as
 * deleteAssignment, then writes ONE bulk audit. Missing/foreign ids are skipped.
 */
export async function bulkDeleteAssignments(ids: string[]) {
  const { organizationId, userId, userName } = await requirePermission("crew", "delete");
  if (ids.length === 0) return serialize({ deleted: 0, skipped: 0 });

  const convex = await getConvexClient();
  // ONE backend-local pass: the cascade loop runs inside a single Convex mutation.
  const { deleted, skipped, projectIds } = await convex.mutation(
    api.crewAssignments.deleteManyCascade,
    { ids, orgId: organizationId },
  );

  if (deleted > 0) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "DELETE",
      entityType: "crew_assignment",
      entityId: ids[0],
      entityName: `${deleted} assignment${deleted === 1 ? "" : "s"}`,
      summary: `Removed ${deleted} crew assignment${deleted === 1 ? "" : "s"}`,
      projectId: projectIds[0],
    });
  }

  return serialize({ deleted, skipped });
}

/**
 * Bulk status change across selected crew assignments in one server round-trip.
 * Mirrors updateAssignmentStatus per item (incl. the first-transition CONFIRMED
 * stamp), then writes ONE bulk audit. Missing/foreign ids are skipped.
 */
export async function bulkUpdateAssignmentStatus(ids: string[], status: string) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");
  if (ids.length === 0) return serialize({ updated: 0, skipped: 0 });

  const convex = await getConvexClient();
  // ONE backend-local pass; the first-transition CONFIRMED stamp is derived
  // per row inside the mutation.
  const { updated, skipped, projectIds } = await convex.mutation(
    api.crewAssignments.patchManyStatus,
    {
      ids,
      orgId: organizationId,
      // The UI only ever sends valid assignment statuses.
      status: status as "PENDING" | "OFFERED" | "ACCEPTED" | "DECLINED" | "CONFIRMED" | "CANCELLED" | "COMPLETED",
      confirmedById: userId,
      now: Date.now(),
    },
  );

  if (updated > 0) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "STATUS_CHANGE",
      entityType: "crew_assignment",
      entityId: ids[0],
      entityName: `${updated} assignment${updated === 1 ? "" : "s"}`,
      summary: `Changed ${updated} crew assignment${updated === 1 ? "" : "s"} to ${status}`,
      projectId: projectIds[0],
    });
  }

  return serialize({ updated, skipped });
}

export async function updateAssignmentStatus(id: string, status: string) {
  const { organizationId, userId, userName } = await requirePermission("crew", "update");

  const assignment = await getAssignmentById(id);
  if (!assignment || assignment.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }

  const crewMemberDoc = await getCrewMemberById(assignment.crewMemberId);
  const crewMember = crewMemberDoc && crewMemberDoc.organizationId === organizationId ? crewMemberDoc : null;
  if (!crewMember) throw new Error("Crew member not found");
  const project = await getProjectById(assignment.projectId);

  const set: Record<string, unknown> = { status, updatedAt: Date.now() };
  // CONFIRMED status-machine stamp (only on the first transition to CONFIRMED).
  if (status === "CONFIRMED" && !assignment.confirmedAt) {
    set.confirmedAt = Date.now();
    set.confirmedById = userId;
  }

  const convex = await getConvexClient();
  await convex.mutation(api.crewAssignments.patchAssignment, { id, set });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "STATUS_CHANGE",
    entityType: "crew_assignment",
    entityId: id,
    entityName: `${crewMember.firstName} ${crewMember.lastName}`,
    summary: `Changed ${crewMember.firstName} ${crewMember.lastName} status to ${status} on ${project?.projectNumber ?? ""}`,
    projectId: assignment.projectId,
  });

  const updated = await getAssignmentById(id);
  return serialize(updated);
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

export async function generateShifts(assignmentId: string) {
  const { organizationId } = await requirePermission("crew", "update");

  const assignment = await getAssignmentById(assignmentId);
  if (!assignment || assignment.organizationId !== organizationId) {
    throw new Error("Assignment not found");
  }
  if (!assignment.startDate || !assignment.endDate) {
    throw new Error("Assignment must have start and end dates to generate shifts");
  }

  const convex = await getConvexClient();

  // Delete existing SCHEDULED shifts (preserves non-SCHEDULED ones), Convex-only.
  await convex.mutation(api.crewShifts.removeScheduledByAssignment, { assignmentId });

  // Regenerate one fresh SCHEDULED shift per day in [startDate, endDate].
  let count = 0;
  const current = new Date(assignment.startDate);
  const end = new Date(assignment.endDate);
  while (current <= end) {
    await convex.mutation(api.crewShifts.create, {
      id: createId(),
      assignmentId,
      date: current.getTime(),
      ...(assignment.startTime ? { callTime: assignment.startTime } : {}),
      ...(assignment.endTime ? { endTime: assignment.endTime } : {}),
      status: "SCHEDULED",
    });
    count++;
    current.setDate(current.getDate() + 1);
  }

  return serialize({ count });
}

export async function updateShift(shiftId: string, data: CrewShiftFormValues) {
  const { organizationId } = await requirePermission("crew", "update");
  const parsed = crewShiftSchema.parse(data);

  const convex = await getConvexClient();
  const shift = await convex.query(api.crewShifts.getById, { id: shiftId });
  if (!shift) throw new Error("Shift not found");
  // Org-scope via the parent assignment.
  const parent = await getAssignmentById(shift.assignmentId);
  if (!parent || parent.organizationId !== organizationId) {
    throw new Error("Shift not found");
  }

  const set: Record<string, unknown> = {
    date: new Date(parsed.date).getTime(),
    status: parsed.status,
  };
  const clear: string[] = [];
  if (parsed.callTime) set.callTime = parsed.callTime;
  else clear.push("callTime");
  if (parsed.endTime) set.endTime = parsed.endTime;
  else clear.push("endTime");
  if (parsed.breakMinutes != null) set.breakMinutes = parsed.breakMinutes;
  else clear.push("breakMinutes");
  if (parsed.location) set.location = parsed.location;
  else clear.push("location");
  if (parsed.notes) set.notes = parsed.notes;
  else clear.push("notes");

  await convex.mutation(api.crewShifts.patchShift, { id: shiftId, set, clear });

  const updated = await convex.query(api.crewShifts.getById, { id: shiftId });
  return serialize(updated ? mapShift(updated) : null);
}

export async function deleteShift(shiftId: string) {
  const { organizationId } = await requirePermission("crew", "update");

  const convex = await getConvexClient();
  const shift = await convex.query(api.crewShifts.getById, { id: shiftId });
  if (!shift) throw new Error("Shift not found");
  // Org-scope via the parent assignment.
  const parent = await getAssignmentById(shift.assignmentId);
  if (!parent || parent.organizationId !== organizationId) {
    throw new Error("Shift not found");
  }

  await convex.mutation(api.crewShifts.remove, { id: shiftId });
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
