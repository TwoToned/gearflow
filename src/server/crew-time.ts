"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  crewTimeEntrySchema,
  type CrewTimeEntryFormValues,
} from "@/lib/validations/crew";
import { logActivity } from "@/lib/activity-log";
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import { getUserMap } from "@/lib/users-read";
import {
  getTimeEntriesByOrg,
  getAssignmentsByOrg,
  type CrewTimeEntryRow,
} from "@/lib/crew-scheduling-read";
import {
  mirrorCrewTimeEntryCreate,
  patchCrewTimeEntryInConvex,
  removeCrewTimeEntryFromConvex,
  syncCrewTimeEntriesToConvex,
} from "@/lib/crew-scheduling-mirror";

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

// Crew time-entry READS moved off Prisma to Convex (Phase A read-rewiring). The
// time entries + assignments come from Convex; members/roles via crew-read,
// projects via projects-read, `approvedBy` (Better Auth User) via users-read
// (auth stays Prisma). The old Prisma where/orderBy/include become JS
// filter/sort/attach. Writes below stay Prisma-first + mirror (read-then-write).

const cmpStr = (a: string, b: string, dir: 1 | -1) => (a < b ? -dir : a > b ? dir : 0);

/** Load the maps needed to attach member / assignment→project / role to entries. */
async function loadAttachMaps(organizationId: string) {
  const [members, roleMap, assignments, projects] = await Promise.all([
    getCrewMembersByOrg(organizationId),
    getCrewRoleMap(organizationId),
    getAssignmentsByOrg(organizationId),
    getProjectsByOrg(organizationId),
  ]);
  return {
    memberMap: new Map(members.map((m) => [m.id, m])),
    roleMap,
    asgMap: new Map(assignments.map((a) => [a.id, a])),
    projMap: new Map(projects.map((p) => [p.id, p])),
  };
}

type AttachMaps = Awaited<ReturnType<typeof loadAttachMaps>>;

/** assignment → { project, crewRole } as the old `include` produced (or null). */
function attachAssignment(entry: CrewTimeEntryRow, maps: AttachMaps) {
  if (!entry.assignmentId) return null;
  const a = maps.asgMap.get(entry.assignmentId);
  if (!a) return null;
  const proj = maps.projMap.get(a.projectId);
  return {
    project: proj ? { id: proj.id, name: proj.name, projectNumber: proj.projectNumber } : null,
    crewRole: a.crewRoleId ? { name: maps.roleMap.get(a.crewRoleId)?.name ?? null } : null,
  };
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
  const sortOrder: "asc" | "desc" = params?.sortOrder || "desc";
  const dir = sortOrder === "asc" ? 1 : -1;

  const [all, maps] = await Promise.all([getTimeEntriesByOrg(organizationId), loadAttachMaps(organizationId)]);

  // Filters
  const f = (params?.filters as Record<string, string[]>) ?? {};
  let rows = all.filter((t) => {
    if (f.status?.length && !f.status.includes(t.status)) return false;
    if (f.crewMemberId?.length && !f.crewMemberId.includes(t.crewMemberId)) return false;
    return true;
  });

  // Search across member name, description, project name/number
  if (params?.search) {
    const q = params.search.toLowerCase();
    rows = rows.filter((t) => {
      const m = maps.memberMap.get(t.crewMemberId);
      const a = t.assignmentId ? maps.asgMap.get(t.assignmentId) : undefined;
      const proj = a ? maps.projMap.get(a.projectId) : undefined;
      return (
        (m?.firstName ?? "").toLowerCase().includes(q) ||
        (m?.lastName ?? "").toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (proj?.name ?? "").toLowerCase().includes(q) ||
        (proj?.projectNumber ?? "").toLowerCase().includes(q)
      );
    });
  }

  const total = rows.length;

  // Sort
  const lastName = (t: CrewTimeEntryRow) => maps.memberMap.get(t.crewMemberId)?.lastName ?? "";
  rows.sort((a, b) => {
    switch (sortBy) {
      case "crewMember": return cmpStr(lastName(a), lastName(b), dir);
      case "startTime": return cmpStr(a.startTime, b.startTime, dir);
      case "status": return cmpStr(a.status, b.status, dir);
      case "totalHours": {
        const av = a.totalHours, bv = b.totalHours;
        if (av == null && bv == null) return 0;
        if (av == null) return dir;   // asc → NULLS LAST; desc → NULLS FIRST
        if (bv == null) return -dir;
        return dir * (av - bv);
      }
      default: {
        // date, with startTime desc tiebreak (matches the old query)
        const d = dir * (a.date.getTime() - b.date.getTime());
        return d !== 0 ? d : cmpStr(a.startTime, b.startTime, -1);
      }
    }
  });

  const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  const userMap = await getUserMap(pageRows.map((t) => t.approvedById));

  const entries = pageRows.map((t) => {
    const m = maps.memberMap.get(t.crewMemberId);
    return {
      ...t,
      crewMember: m ? { id: m.id, firstName: m.firstName, lastName: m.lastName } : null,
      assignment: attachAssignment(t, maps),
      approvedBy: t.approvedById ? { name: userMap.get(t.approvedById)?.name ?? null } : null,
    };
  });

  return serialize({ entries, total });
}

export async function getTimeEntriesForMember(crewMemberId: string) {
  const { organizationId } = await getOrgContext();

  const members = await getCrewMembersByOrg(organizationId);
  if (!members.some((m) => m.id === crewMemberId)) throw new Error("Crew member not found");

  const [all, maps] = await Promise.all([getTimeEntriesByOrg(organizationId), loadAttachMaps(organizationId)]);
  const rows = all
    .filter((t) => t.crewMemberId === crewMemberId)
    .sort((a, b) => b.date.getTime() - a.date.getTime() || cmpStr(a.startTime, b.startTime, -1));
  const userMap = await getUserMap(rows.map((t) => t.approvedById));

  const entries = rows.map((t) => ({
    ...t,
    assignment: attachAssignment(t, maps),
    approvedBy: t.approvedById ? { name: userMap.get(t.approvedById)?.name ?? null } : null,
  }));

  return serialize(entries);
}

export async function getTimeEntriesForProject(projectId: string) {
  const { organizationId } = await getOrgContext();

  const [all, maps] = await Promise.all([getTimeEntriesByOrg(organizationId), loadAttachMaps(organizationId)]);
  const rows = all
    .filter((t) => {
      const a = t.assignmentId ? maps.asgMap.get(t.assignmentId) : undefined;
      return a?.projectId === projectId;
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime() || cmpStr(a.startTime, b.startTime, -1));
  const userMap = await getUserMap(rows.map((t) => t.approvedById));

  const entries = rows.map((t) => {
    const m = maps.memberMap.get(t.crewMemberId);
    const a = t.assignmentId ? maps.asgMap.get(t.assignmentId) : undefined;
    return {
      ...t,
      crewMember: m ? { firstName: m.firstName, lastName: m.lastName } : null,
      assignment: a ? { crewRole: a.crewRoleId ? { name: maps.roleMap.get(a.crewRoleId)?.name ?? null } : null } : null,
      approvedBy: t.approvedById ? { name: userMap.get(t.approvedById)?.name ?? null } : null,
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

  const [all, maps] = await Promise.all([getTimeEntriesByOrg(organizationId), loadAttachMaps(organizationId)]);

  const fromMs = filters?.dateFrom ? new Date(filters.dateFrom).getTime() : null;
  const toMs = filters?.dateTo ? new Date(filters.dateTo).getTime() : null;

  const rows = all
    .filter((t) => {
      if (filters?.crewMemberId && t.crewMemberId !== filters.crewMemberId) return false;
      if (filters?.status && t.status !== filters.status) return false;
      if (filters?.projectId) {
        const a = t.assignmentId ? maps.asgMap.get(t.assignmentId) : undefined;
        if (a?.projectId !== filters.projectId) return false;
      }
      if (fromMs != null && t.date.getTime() < fromMs) return false;
      if (toMs != null && t.date.getTime() > toMs) return false;
      return true;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime() || cmpStr(a.crewMemberId, b.crewMemberId, 1));

  const escapeCSV = (val: string) => {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const header =
    "Crew Member,Email,Project Number,Project Name,Role,Description,Date,Start Time,End Time,Break (min),Total Hours,Status";
  const lines = rows.map((e) => {
    const m = maps.memberMap.get(e.crewMemberId);
    const a = e.assignmentId ? maps.asgMap.get(e.assignmentId) : undefined;
    const proj = a ? maps.projMap.get(a.projectId) : undefined;
    const roleName = a?.crewRoleId ? maps.roleMap.get(a.crewRoleId)?.name ?? "" : "";
    const name = `${m?.firstName ?? ""} ${m?.lastName ?? ""}`;
    const date = e.date.toISOString().split("T")[0];
    return [
      escapeCSV(name),
      escapeCSV(m?.email || ""),
      escapeCSV(proj?.projectNumber || ""),
      escapeCSV(proj?.name || ""),
      escapeCSV(roleName),
      escapeCSV(e.description || ""),
      date,
      e.startTime,
      e.endTime,
      String(e.breakMinutes),
      e.totalHours?.toString() || "",
      e.status,
    ].join(",");
  });

  return [header, ...lines].join("\n");
}
