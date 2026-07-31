import { describe, it, expect } from "vitest";
import {
  countDueMaintenance,
  aggregateMaintenanceForProject,
  type MaintenanceRecordRow,
} from "@/lib/maintenance-read";
import {
  countAssignmentsByStatus,
  countTimeEntriesByStatus,
  type ConvexCrewAssignment,
  type ConvexCrewTimeEntry,
} from "@/lib/crew-scheduling-read";
import { countActiveCrew, type ConvexCrewMember } from "@/lib/crew-read";
import {
  sumProjectServiceRevenue,
  type ConvexProjectService,
} from "@/lib/project-services-read";

// Minimal builders — the pure functions only touch the scalar fields under test.
// countDueMaintenance / aggregateMaintenanceForProject operate on the MAPPED
// MaintenanceRecordRow (scheduledDate is a Date), matching how the dashboard /
// project-cost server actions feed them via getMaintenanceRecordsByOrg.
function maint(p: {
  status?: string;
  scheduledDate?: number;
  projectId?: string;
  cost?: number;
}): MaintenanceRecordRow {
  return {
    id: "m",
    organizationId: "org",
    kitId: null,
    projectId: p.projectId ?? null,
    type: "REPAIR" as MaintenanceRecordRow["type"],
    status: (p.status ?? "SCHEDULED") as MaintenanceRecordRow["status"],
    title: "t",
    description: null,
    reportedById: null,
    assignedToId: null,
    scheduledDate: p.scheduledDate == null ? null : new Date(p.scheduledDate),
    completedDate: null,
    cost: p.cost ?? null,
    partsUsed: null,
    attachments: [],
    photos: [],
    result: null,
    nextDueDate: null,
    tags: [],
    incidentType: null,
    incidentSeverity: null,
    lineItemId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}
function asn(p: Partial<ConvexCrewAssignment>): ConvexCrewAssignment {
  return { id: "a", organizationId: "org", projectId: "p", crewMemberId: "c", ...p } as ConvexCrewAssignment;
}
function te(p: Partial<ConvexCrewTimeEntry>): ConvexCrewTimeEntry {
  return { id: "t", organizationId: "org", crewMemberId: "c", ...p } as ConvexCrewTimeEntry;
}
function member(p: Partial<ConvexCrewMember>): ConvexCrewMember {
  return { id: "cm", organizationId: "org", firstName: "A", lastName: "B", ...p } as ConvexCrewMember;
}
function svc(p: Partial<ConvexProjectService>): ConvexProjectService {
  return { id: "s", organizationId: "org", projectId: "p", title: "T", ...p } as ConvexProjectService;
}

const NOW = 1_000_000;

describe("countDueMaintenance", () => {
  it("counts SCHEDULED/IN_PROGRESS with scheduledDate <= cutoff", () => {
    const records = [
      maint({ status: "SCHEDULED", scheduledDate: NOW - 1 }), // due
      maint({ status: "IN_PROGRESS", scheduledDate: NOW }), // due (boundary inclusive)
      maint({ status: "SCHEDULED", scheduledDate: NOW + 1 }), // not yet due
      maint({ status: "COMPLETED", scheduledDate: NOW - 1 }), // wrong status
      maint({ status: "CANCELLED", scheduledDate: NOW - 1 }), // wrong status
      maint({ status: "SCHEDULED", scheduledDate: undefined }), // no date → excluded (Prisma lte skips NULL)
    ];
    expect(countDueMaintenance(records, NOW)).toBe(2);
  });

  it("returns 0 for empty input", () => {
    expect(countDueMaintenance([], NOW)).toBe(0);
  });
});

describe("aggregateMaintenanceForProject", () => {
  it("sums cost and counts non-CANCELLED records for the project", () => {
    const records = [
      maint({ projectId: "p1", status: "COMPLETED", cost: 100 }),
      maint({ projectId: "p1", status: "SCHEDULED", cost: 50 }),
      maint({ projectId: "p1", status: "CANCELLED", cost: 999 }), // excluded
      maint({ projectId: "p1", status: "SCHEDULED", cost: undefined }), // null cost → 0
      maint({ projectId: "p2", status: "COMPLETED", cost: 7 }), // other project
    ];
    expect(aggregateMaintenanceForProject(records, "p1")).toEqual({ costTotal: 150, count: 3 });
  });

  it("returns zeroed aggregate when no records match", () => {
    expect(aggregateMaintenanceForProject([], "p1")).toEqual({ costTotal: 0, count: 0 });
  });
});

describe("countAssignmentsByStatus", () => {
  it("counts assignments whose status is in the set", () => {
    const rows = [
      asn({ status: "OFFERED" }),
      asn({ status: "PENDING" }),
      asn({ status: "OFFERED" }),
      asn({ status: "CONFIRMED" }),
      asn({ status: undefined }),
    ];
    expect(countAssignmentsByStatus(rows, ["OFFERED", "PENDING"])).toBe(3);
    expect(countAssignmentsByStatus(rows, ["OFFERED"])).toBe(2);
  });
});

describe("countTimeEntriesByStatus", () => {
  it("counts SUBMITTED time entries", () => {
    const rows = [
      te({ status: "SUBMITTED" }),
      te({ status: "APPROVED" }),
      te({ status: "SUBMITTED" }),
      te({ status: undefined }),
    ];
    expect(countTimeEntriesByStatus(rows, ["SUBMITTED"])).toBe(2);
  });
});

describe("countActiveCrew", () => {
  it("counts only ACTIVE members", () => {
    const rows = [
      member({ status: "ACTIVE" }),
      member({ status: "INACTIVE" }),
      member({ status: "ACTIVE" }),
      member({ status: "ARCHIVED" }),
      member({ status: undefined }),
    ];
    expect(countActiveCrew(rows)).toBe(2);
  });
});

describe("sumProjectServiceRevenue", () => {
  it("sums lineTotal for non-CANCELLED services of the project — billable is derived from the charge, not a showOnDocuments flag", () => {
    const rows = [
      svc({ projectId: "p1", status: "CONFIRMED", lineTotal: 100 }),
      svc({ projectId: "p1", status: "PLANNED", lineTotal: 50 }),
      svc({ projectId: "p1", status: "CANCELLED", lineTotal: 999 }), // excluded — cancelled
      svc({ projectId: "p1", status: "CONFIRMED", showOnDocuments: false, lineTotal: 999 }), // showOnDocuments no longer gates — counted
      svc({ projectId: "p1", status: "CONFIRMED", lineTotal: undefined }), // no charge set → 0
      svc({ projectId: "p2", status: "CONFIRMED", lineTotal: 7 }), // other project
    ];
    expect(sumProjectServiceRevenue(rows, "p1")).toBe(1149);
  });

  it("returns 0 when nothing matches", () => {
    expect(sumProjectServiceRevenue([], "p1")).toBe(0);
  });
});
