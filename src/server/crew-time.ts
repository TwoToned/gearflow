"use server";

import { requirePermission } from "@/lib/org-context";
import { getCrewMembersByOrg, getCrewRoleMap } from "@/lib/crew-read";
import { getProjectsByOrg } from "@/lib/projects-read";
import {
  getTimeEntriesByOrg,
  getAssignmentsByOrg,
} from "@/lib/crew-scheduling-read";

// The time-entry reads + CRUD + status machine are browser-direct (Phase 3):
// convex/crewTimeEntriesWrites.ts + convex/crewTimeEntries.ts (allEntries/forMember).
// Only the Node-side CSV export stays here (it stays server per the KEEP set).

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
