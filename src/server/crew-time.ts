"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import {
  crewTimeEntrySchema,
  type CrewTimeEntryFormValues,
} from "@/lib/validations/crew";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { createId } from "@paralleldrive/cuid2";
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getTimeEntriesByOrg,
  getAssignmentById,
  getAssignmentsByOrg,
  filterTimeEntries,
  sortTimeEntries,
  paginate,
  sortTimeEntriesDateThenStartDesc,
  mapTimeEntry,
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

  // Verify crew member belongs to org (Convex read).
  const members = await getCrewMembersByOrg(organizationId);
  const crewMember = members.find((m) => m.id === parsed.crewMemberId);
  if (!crewMember) throw new Error("Crew member not found");

  // If linked to an assignment, verify it (Convex read; org-scope + member match).
  let projectName = parsed.description || "General";
  if (assignmentId) {
    const assignment = await getAssignmentById(assignmentId);
    if (!assignment || assignment.organizationId !== organizationId) {
      throw new Error("Assignment not found");
    }
    if (assignment.crewMemberId !== parsed.crewMemberId) {
      throw new Error("Crew member does not match assignment");
    }
    const projects = await getProjectsByOrg(organizationId);
    projectName = projects.find((p) => p.id === assignment.projectId)?.name ?? projectName;
  }

  const totalHours = calculateTotalHours(
    parsed.startTime,
    parsed.endTime,
    parsed.breakMinutes ?? 0
  );

  // Convex-only write: cuid minted here, dates → epoch-ms, nulls omitted.
  const convex = await getConvexClient();
  const id = createId();
  const now = Date.now();
  await convex.mutation(api.crewTimeEntries.create, {
    id,
    organizationId,
    ...(assignmentId ? { assignmentId } : {}),
    crewMemberId: parsed.crewMemberId,
    ...(parsed.description ? { description: parsed.description } : {}),
    date: new Date(parsed.date as unknown as string).getTime(),
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    breakMinutes: parsed.breakMinutes ?? 0,
    totalHours,
    status: "DRAFT",
    ...(parsed.notes ? { notes: parsed.notes } : {}),
    createdAt: now,
    updatedAt: now,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "crew_time_entry",
    entityId: id,
    entityName: `${crewMember.firstName} ${crewMember.lastName}`,
    summary: `Logged time for ${crewMember.firstName} ${crewMember.lastName} on ${projectName}`,
  });

  const created = await convex.query(api.crewTimeEntries.getById, { id });
  return serialize(created ? mapTimeEntry(created) : null);
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

  // Read-before-write guard from Convex (org-scope on the entry's organizationId).
  const allEntries = await getTimeEntriesByOrg(organizationId);
  const existing = allEntries.find((e) => e.id === id);
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error("Time entry not found");
  }
  if (existing.status === "EXPORTED") {
    throw new Error("Cannot edit exported time entries");
  }

  const members = await getCrewMembersByOrg(organizationId);
  const crewMember = members.find((m) => m.id === existing.crewMemberId);
  const crewName = crewMember
    ? `${crewMember.firstName} ${crewMember.lastName}`
    : "crew member";

  const totalHours = calculateTotalHours(
    parsed.startTime,
    parsed.endTime,
    parsed.breakMinutes ?? 0
  );

  // Convex-only write. Editing always resets to DRAFT and clears any approval
  // (Convex optionals can't hold null → unset via `clear`).
  const convex = await getConvexClient();
  await convex.mutation(api.crewTimeEntries.patchTimeEntry, {
    id,
    set: {
      ...(parsed.assignmentId ? { assignmentId: parsed.assignmentId } : {}),
      ...(parsed.description ? { description: parsed.description } : {}),
      date: new Date(parsed.date as unknown as string).getTime(),
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      breakMinutes: parsed.breakMinutes ?? 0,
      totalHours,
      ...(parsed.notes ? { notes: parsed.notes } : {}),
      status: "DRAFT",
      updatedAt: Date.now(),
    },
    clear: [
      "approvedById",
      "approvedAt",
      ...(parsed.assignmentId ? [] : ["assignmentId"]),
      ...(parsed.description ? [] : ["description"]),
      ...(parsed.notes ? [] : ["notes"]),
    ],
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_time_entry",
    entityId: id,
    entityName: crewName,
    summary: `Updated time entry for ${crewName}`,
  });

  const updated = await convex.query(api.crewTimeEntries.getById, { id });
  return serialize(updated ? mapTimeEntry(updated) : null);
}

export async function deleteTimeEntry(id: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "delete"
  );

  // Read-before-write guard from Convex (org-scope on the entry's organizationId).
  const allEntries = await getTimeEntriesByOrg(organizationId);
  const entry = allEntries.find((e) => e.id === id);
  if (!entry || entry.organizationId !== organizationId) {
    throw new Error("Time entry not found");
  }
  if (entry.status === "EXPORTED") {
    throw new Error("Cannot delete exported time entries");
  }

  const members = await getCrewMembersByOrg(organizationId);
  const crewMember = members.find((m) => m.id === entry.crewMemberId);
  const crewName = crewMember
    ? `${crewMember.firstName} ${crewMember.lastName}`
    : "crew member";

  const convex = await getConvexClient();
  await convex.mutation(api.crewTimeEntries.remove, { id });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "DELETE",
    entityType: "crew_time_entry",
    entityId: id,
    entityName: crewName,
    summary: `Deleted time entry for ${crewName}`,
  });

  return { success: true };
}

// ─── Status Transitions ─────────────────────────────────────────────────────

export async function submitTimeEntries(ids: string[]) {
  const { organizationId, userId, userName } = await requirePermission(
    "crew",
    "update"
  );

  // Read eligible entries from Convex, apply the DRAFT|DISPUTED → SUBMITTED guard.
  const idSet = new Set(ids);
  const allEntries = await getTimeEntriesByOrg(organizationId);
  const entries = allEntries.filter(
    (e) =>
      idSet.has(e.id) &&
      e.organizationId === organizationId &&
      ["DRAFT", "DISPUTED"].includes(e.status),
  );

  if (entries.length === 0) throw new Error("No eligible entries found");

  const convex = await getConvexClient();
  const now = Date.now();
  for (const e of entries) {
    await convex.mutation(api.crewTimeEntries.patchTimeEntry, {
      id: e.id,
      set: { status: "SUBMITTED", updatedAt: now },
    });
  }

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

  // Read eligible entries from Convex, apply the SUBMITTED|DISPUTED → APPROVED
  // guard, stamping approvedById + approvedAt.
  const idSet = new Set(ids);
  const allEntries = await getTimeEntriesByOrg(organizationId);
  const entries = allEntries.filter(
    (e) =>
      idSet.has(e.id) &&
      e.organizationId === organizationId &&
      ["SUBMITTED", "DISPUTED"].includes(e.status),
  );

  if (entries.length === 0) throw new Error("No eligible entries found");

  const convex = await getConvexClient();
  const now = Date.now();
  for (const e of entries) {
    await convex.mutation(api.crewTimeEntries.patchTimeEntry, {
      id: e.id,
      set: {
        status: "APPROVED",
        approvedById: userId,
        approvedAt: now,
        updatedAt: now,
      },
    });
  }

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

  // Read-before-write guard from Convex; apply the SUBMITTED|APPROVED → DISPUTED guard.
  const allEntries = await getTimeEntriesByOrg(organizationId);
  const entry = allEntries.find((e) => e.id === id);
  if (!entry || entry.organizationId !== organizationId) {
    throw new Error("Time entry not found");
  }
  if (!["SUBMITTED", "APPROVED"].includes(entry.status)) {
    throw new Error("Can only dispute submitted or approved time entries");
  }

  const members = await getCrewMembersByOrg(organizationId);
  const crewMember = members.find((m) => m.id === entry.crewMemberId);
  const crewName = crewMember
    ? `${crewMember.firstName} ${crewMember.lastName}`
    : "crew member";

  const convex = await getConvexClient();
  const nextNotes = reason || entry.notes;
  await convex.mutation(api.crewTimeEntries.patchTimeEntry, {
    id,
    set: {
      status: "DISPUTED",
      ...(nextNotes ? { notes: nextNotes } : {}),
      updatedAt: Date.now(),
    },
    ...(nextNotes ? {} : { clear: ["notes"] }),
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "crew_time_entry",
    entityId: id,
    entityName: crewName,
    summary: `Disputed time entry for ${crewName}`,
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

  // All reads come from Convex (timeEntry/assignment dual-written; crewMember,
  // crewRole, project Convex-backed). Replicates the Prisma where + orderBy in JS.
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

  const dateFrom = filters?.dateFrom ? new Date(filters.dateFrom).getTime() : null;
  const dateTo = filters?.dateTo ? new Date(filters.dateTo).getTime() : null;

  const entries = allEntries
    .filter((e) => {
      if (filters?.crewMemberId && e.crewMemberId !== filters.crewMemberId) return false;
      if (filters?.status && e.status !== filters.status) return false;
      if (filters?.projectId) {
        const a = e.assignmentId ? assignmentById.get(e.assignmentId) : null;
        if (!a || a.projectId !== filters.projectId) return false;
      }
      const t = e.date.getTime();
      if (dateFrom != null && t < dateFrom) return false;
      if (dateTo != null && t > dateTo) return false;
      return true;
    })
    // orderBy [{ date: "asc" }, { crewMemberId: "asc" }]
    .sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() || a.crewMemberId.localeCompare(b.crewMemberId),
    );

  const escapeCSV = (val: string) => {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const header =
    "Crew Member,Email,Project Number,Project Name,Role,Description,Date,Start Time,End Time,Break (min),Total Hours,Status";
  const rows = entries.map((e) => {
    const member = memberById.get(e.crewMemberId);
    const assignment = e.assignmentId ? assignmentById.get(e.assignmentId) : null;
    const project = assignment ? projectsById.get(assignment.projectId) : null;
    const role = assignment?.crewRoleId ? roleMap.get(assignment.crewRoleId) : null;
    const name = `${member?.firstName ?? ""} ${member?.lastName ?? ""}`;
    const date = new Date(e.date).toISOString().split("T")[0];
    return [
      escapeCSV(name),
      escapeCSV(member?.email || ""),
      escapeCSV(project?.projectNumber || ""),
      escapeCSV(project?.name || ""),
      escapeCSV(role?.name || ""),
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
