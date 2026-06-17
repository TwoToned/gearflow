"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  crewTimeEntrySchema,
  type CrewTimeEntryFormValues,
} from "@/lib/validations/crew";
import { logActivity } from "@/lib/activity-log";
import {
  mirrorCrewTimeEntryCreate,
  patchCrewTimeEntryInConvex,
  removeCrewTimeEntryFromConvex,
  syncCrewTimeEntriesToConvex,
} from "@/lib/crew-scheduling-mirror";
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getTimeEntriesByOrg,
  getAssignmentsByOrg,
  filterTimeEntries,
  sortTimeEntries,
  paginate,
  sortTimeEntriesDateThenStartDesc,
  type MappedCrewTimeEntry,
} from "@/lib/crew-scheduling-read";

// ─── Helpers ────────────────────────────────────────────────────────────────

function calculateTotalHours(
  startTime: string,
  endTime: string,
  breakMinutes: number
): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  const worked = endMins - startMins - breakMinutes;
  return Math.max(0, Math.round(worked * 100 / 60) / 100);
}

// ─── Read-side join helpers (Convex reads + batched auth-User join) ───────────

/**
 * Batched Better Auth `User.name` lookup for the `approvedBy` join — User stays in
 * Postgres (auth is not migrated to Convex). One query for all approver ids.
 */
async function getApproverNameMap(
  entries: MappedCrewTimeEntry[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(entries.map((e) => e.approvedById).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name ?? null]));
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function getAllTimeEntries(params?: {
  search?: string;
  filters?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const { organizationId } = await getOrgContext();

  const page = params?.page || 1;
  const pageSize = params?.pageSize || 25;
  const sortBy = params?.sortBy || "date";
  const sortOrder = params?.sortOrder || "desc";

  const [allEntries, assignments, members, roleMap, projects] = await Promise.all([
    getTimeEntriesByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const nameOf = (e: MappedCrewTimeEntry) => {
    const m = memberById.get(e.crewMemberId);
    return { firstName: m?.firstName ?? "", lastName: m?.lastName ?? "" };
  };
  const projectOf = (e: MappedCrewTimeEntry) => {
    const a = e.assignmentId ? assignmentById.get(e.assignmentId) : null;
    const p = a ? projectsById.get(a.projectId) : null;
    return p ? { name: p.name, projectNumber: p.projectNumber } : null;
  };

  const filtered = filterTimeEntries(allEntries, params, { nameOf, projectOf });
  const sorted = sortTimeEntries(filtered, sortBy, sortOrder, {
    lastNameOf: (e) => memberById.get(e.crewMemberId)?.lastName,
  });
  const total = filtered.length;
  const pageEntries = paginate(sorted, page, pageSize);

  const approverNames = await getApproverNameMap(pageEntries);

  const entries = pageEntries.map((e) => {
    const member = memberById.get(e.crewMemberId) ?? null;
    const assignment = e.assignmentId ? assignmentById.get(e.assignmentId) ?? null : null;
    const project = assignment ? projectsById.get(assignment.projectId) ?? null : null;
    const role = assignment?.crewRoleId ? roleMap.get(assignment.crewRoleId) ?? null : null;
    return {
      ...e,
      crewMember: member ? { id: member.id, firstName: member.firstName, lastName: member.lastName } : null,
      assignment: assignment
        ? {
            ...assignment,
            project: project ? { id: project.id, name: project.name, projectNumber: project.projectNumber } : null,
            crewRole: role ? { name: role.name } : null,
          }
        : null,
      approvedBy: e.approvedById ? { name: approverNames.get(e.approvedById) ?? null } : null,
    };
  });

  return serialize({ entries, total });
}

export async function getTimeEntriesForMember(crewMemberId: string) {
  const { organizationId } = await getOrgContext();

  const [allEntries, assignments, members, roleMap, projects] = await Promise.all([
    getTimeEntriesByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  const member = members.find((m) => m.id === crewMemberId);
  if (!member) throw new Error("Crew member not found");

  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const sorted = sortTimeEntriesDateThenStartDesc(
    allEntries.filter((e) => e.crewMemberId === crewMemberId),
  );
  const approverNames = await getApproverNameMap(sorted);

  const entries = sorted.map((e) => {
    const assignment = e.assignmentId ? assignmentById.get(e.assignmentId) ?? null : null;
    const project = assignment ? projectsById.get(assignment.projectId) ?? null : null;
    const role = assignment?.crewRoleId ? roleMap.get(assignment.crewRoleId) ?? null : null;
    return {
      ...e,
      assignment: assignment
        ? {
            ...assignment,
            project: project ? { name: project.name, projectNumber: project.projectNumber } : null,
            crewRole: role ? { name: role.name } : null,
          }
        : null,
      approvedBy: e.approvedById ? { name: approverNames.get(e.approvedById) ?? null } : null,
    };
  });

  return serialize(entries);
}

export async function getTimeEntriesForProject(projectId: string) {
  const { organizationId } = await getOrgContext();

  const [allEntries, assignments, members, roleMap] = await Promise.all([
    getTimeEntriesByOrg(organizationId),
    getAssignmentsByOrg(organizationId),
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const projectAssignmentIds = new Set(
    assignments.filter((a) => a.projectId === projectId).map((a) => a.id),
  );

  const sorted = sortTimeEntriesDateThenStartDesc(
    allEntries.filter((e) => e.assignmentId != null && projectAssignmentIds.has(e.assignmentId)),
  );
  const approverNames = await getApproverNameMap(sorted);

  const entries = sorted.map((e) => {
    const member = memberById.get(e.crewMemberId) ?? null;
    const assignment = e.assignmentId ? assignmentById.get(e.assignmentId) ?? null : null;
    const role = assignment?.crewRoleId ? roleMap.get(assignment.crewRoleId) ?? null : null;
    return {
      ...e,
      crewMember: member ? { firstName: member.firstName, lastName: member.lastName } : null,
      assignment: assignment
        ? {
            ...assignment,
            crewRole: role ? { name: role.name } : null,
          }
        : null,
      approvedBy: e.approvedById ? { name: approverNames.get(e.approvedById) ?? null } : null,
    };
  });

  return serialize(entries);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createTimeEntry(data: CrewTimeEntryFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "create"
  );
  const parsed = crewTimeEntrySchema.parse(data);
  const assignmentId = parsed.assignmentId || null;

  // Verify crew member belongs to org
  const crewMember = await prisma.crewMember.findUnique({
    where: { id: parsed.crewMemberId, organizationId },
    select: { firstName: true, lastName: true },
  });
  if (!crewMember) throw new Error("Crew member not found");

  // If linked to an assignment, verify it
  let projectName = parsed.description || "General";
  if (assignmentId) {
    const assignment = await prisma.crewAssignment.findUnique({
      where: { id: assignmentId, organizationId },
      include: { project: { select: { name: true } } },
    });
    if (!assignment) throw new Error("Assignment not found");
    if (assignment.crewMemberId !== parsed.crewMemberId) {
      throw new Error("Crew member does not match assignment");
    }
    projectName = assignment.project.name;
  }

  const totalHours = calculateTotalHours(
    parsed.startTime,
    parsed.endTime,
    parsed.breakMinutes ?? 0
  );

  const entry = await prisma.crewTimeEntry.create({
    data: {
      organizationId,
      assignmentId,
      crewMemberId: parsed.crewMemberId,
      description: parsed.description || null,
      date: new Date(parsed.date as unknown as string),
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      breakMinutes: parsed.breakMinutes ?? 0,
      totalHours,
      notes: parsed.notes || null,
    },
    include: {
      assignment: {
        include: {
          project: { select: { name: true, projectNumber: true } },
          crewRole: { select: { name: true } },
        },
      },
      approvedBy: { select: { name: true } },
    },
  });

  await mirrorCrewTimeEntryCreate(entry as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "crew_time_entry",
    entityId: entry.id,
    entityName: `${crewMember.firstName} ${crewMember.lastName}`,
    summary: `Logged time for ${crewMember.firstName} ${crewMember.lastName} on ${projectName}`,
  });

  return serialize(entry);
}

export async function updateTimeEntry(
  id: string,
  data: CrewTimeEntryFormValues
) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );
  const parsed = crewTimeEntrySchema.parse(data);

  const existing = await prisma.crewTimeEntry.findUnique({
    where: { id },
    include: {
      crewMember: { select: { organizationId: true, firstName: true, lastName: true } },
    },
  });
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Time entry not found");
  }
  if (existing.status === "EXPORTED") {
    throw new Error("Cannot edit exported time entries");
  }

  const totalHours = calculateTotalHours(
    parsed.startTime,
    parsed.endTime,
    parsed.breakMinutes ?? 0
  );

  const entry = await prisma.crewTimeEntry.update({
    where: { id },
    data: {
      assignmentId: parsed.assignmentId || null,
      description: parsed.description || null,
      date: new Date(parsed.date as unknown as string),
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      breakMinutes: parsed.breakMinutes ?? 0,
      totalHours,
      notes: parsed.notes || null,
      // Reset to draft if edited from a non-draft state
      status: existing.status !== "DRAFT" ? "DRAFT" : "DRAFT",
      approvedById: null,
      approvedAt: null,
    },
    include: {
      assignment: {
        include: {
          project: { select: { name: true, projectNumber: true } },
          crewRole: { select: { name: true } },
        },
      },
      approvedBy: { select: { name: true } },
    },
  });

  await patchCrewTimeEntryInConvex(id, entry as unknown as Record<string, unknown>);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_time_entry",
    entityId: id,
    entityName: `${existing.crewMember.firstName} ${existing.crewMember.lastName}`,
    summary: `Updated time entry for ${existing.crewMember.firstName} ${existing.crewMember.lastName}`,
  });

  return serialize(entry);
}

export async function deleteTimeEntry(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "delete"
  );

  const entry = await prisma.crewTimeEntry.findUnique({
    where: { id },
    include: {
      crewMember: { select: { organizationId: true, firstName: true, lastName: true } },
    },
  });
  if (!entry || entry.organizationId !== organizationId) {
    throw new Error("Time entry not found");
  }
  if (entry.status === "EXPORTED") {
    throw new Error("Cannot delete exported time entries");
  }

  await prisma.crewTimeEntry.delete({ where: { id } });
  await removeCrewTimeEntryFromConvex(id);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "crew_time_entry",
    entityId: id,
    entityName: `${entry.crewMember.firstName} ${entry.crewMember.lastName}`,
    summary: `Deleted time entry for ${entry.crewMember.firstName} ${entry.crewMember.lastName}`,
  });

  return { success: true };
}

// ─── Status Transitions ─────────────────────────────────────────────────────

export async function submitTimeEntries(ids: string[]) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const entries = await prisma.crewTimeEntry.findMany({
    where: { id: { in: ids }, organizationId, status: { in: ["DRAFT", "DISPUTED"] } },
    include: {
      crewMember: { select: { firstName: true, lastName: true } },
    },
  });

  if (entries.length === 0) throw new Error("No eligible entries found");

  await prisma.crewTimeEntry.updateMany({
    where: { id: { in: entries.map((e) => e.id) } },
    data: { status: "SUBMITTED" },
  });

  await syncCrewTimeEntriesToConvex(entries.map((e) => e.id));

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_time_entry",
    entityId: ids.join(","),
    entityName: `${entries.length} time entries`,
    summary: `Submitted ${entries.length} time entries for approval`,
  });

  return { success: true, count: entries.length };
}

export async function approveTimeEntries(ids: string[]) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const entries = await prisma.crewTimeEntry.findMany({
    where: { id: { in: ids }, organizationId, status: { in: ["SUBMITTED", "DISPUTED"] } },
  });

  if (entries.length === 0) throw new Error("No eligible entries found");

  await prisma.crewTimeEntry.updateMany({
    where: { id: { in: entries.map((e) => e.id) } },
    data: {
      status: "APPROVED",
      approvedById: userId,
      approvedAt: new Date(),
    },
  });

  await syncCrewTimeEntriesToConvex(entries.map((e) => e.id));

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_time_entry",
    entityId: ids.join(","),
    entityName: `${entries.length} time entries`,
    summary: `Approved ${entries.length} time entries`,
  });

  return { success: true, count: entries.length };
}

export async function disputeTimeEntry(id: string, reason?: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  const entry = await prisma.crewTimeEntry.findUnique({
    where: { id },
    include: {
      crewMember: { select: { organizationId: true, firstName: true, lastName: true } },
    },
  });
  if (!entry || entry.organizationId !== organizationId) {
    throw new Error("Time entry not found");
  }
  if (!["SUBMITTED", "APPROVED"].includes(entry.status)) {
    throw new Error("Can only dispute submitted or approved time entries");
  }

  await prisma.crewTimeEntry.update({
    where: { id },
    data: {
      status: "DISPUTED",
      notes: reason || entry.notes,
    },
  });

  await syncCrewTimeEntriesToConvex([id]);

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_time_entry",
    entityId: id,
    entityName: `${entry.crewMember.firstName} ${entry.crewMember.lastName}`,
    summary: `Disputed time entry for ${entry.crewMember.firstName} ${entry.crewMember.lastName}`,
  });

  return { success: true };
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

export async function exportTimesheetCSV(filters?: {
  dateFrom?: string;
  dateTo?: string;
  crewMemberId?: string;
  projectId?: string;
  status?: string;
}) {
  const { organizationId } = await requirePermission("crew", "read");

  const where: Record<string, unknown> = { organizationId };

  if (filters?.crewMemberId) where.crewMemberId = filters.crewMemberId;
  if (filters?.status) where.status = filters.status;
  if (filters?.projectId) {
    where.assignment = { projectId: filters.projectId };
  }
  if (filters?.dateFrom || filters?.dateTo) {
    where.date = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
    };
  }

  const entries = await prisma.crewTimeEntry.findMany({
    where,
    include: {
      crewMember: { select: { firstName: true, lastName: true, email: true } },
      assignment: {
        include: {
          project: { select: { name: true, projectNumber: true } },
          crewRole: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }, { crewMemberId: "asc" }],
  });

  const escapeCSV = (val: string) => {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const header =
    "Crew Member,Email,Project Number,Project Name,Role,Description,Date,Start Time,End Time,Break (min),Total Hours,Status";
  const rows = entries.map((e) => {
    const name = `${e.crewMember.firstName} ${e.crewMember.lastName}`;
    const date = new Date(e.date).toISOString().split("T")[0];
    return [
      escapeCSV(name),
      escapeCSV(e.crewMember.email || ""),
      escapeCSV(e.assignment?.project?.projectNumber || ""),
      escapeCSV(e.assignment?.project?.name || ""),
      escapeCSV(e.assignment?.crewRole?.name || ""),
      escapeCSV(e.description || ""),
      date,
      e.startTime,
      e.endTime,
      String(e.breakMinutes),
      e.totalHours?.toString() || "",
      e.status,
    ].join(",");
  });

  return [header, ...rows].join("\n");
}
