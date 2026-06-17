import { describe, it, expect } from "vitest";
import {
  mapCallSheetMilestoneDates,
  buildCallSheetServiceDates,
  type ConvexProject,
  type ConvexProjectService,
  type ConvexCrewAssignment,
} from "@/lib/projects-read";

/**
 * Tests for the pure call-sheet read helpers extracted from the (now
 * Convex-backed) `getCallSheetDates` server action. These replicate the old
 * Prisma `where`/`orderBy`/`_count` semantics in JS.
 */

function project(overrides: Partial<ConvexProject> = {}): ConvexProject {
  return {
    _id: "x" as ConvexProject["_id"],
    _creationTime: 0,
    id: "p1",
    organizationId: "org1",
    projectNumber: "P-001",
    name: "Test",
    ...overrides,
  } as ConvexProject;
}

function service(overrides: Partial<ConvexProjectService> = {}): ConvexProjectService {
  return {
    _id: "s" as ConvexProjectService["_id"],
    _creationTime: 0,
    id: "svc",
    organizationId: "org1",
    projectId: "p1",
    type: "LABOUR",
    title: "Svc",
    ...overrides,
  } as ConvexProjectService;
}

function assignment(overrides: Partial<ConvexCrewAssignment> = {}): ConvexCrewAssignment {
  return {
    _id: "a" as ConvexCrewAssignment["_id"],
    _creationTime: 0,
    id: "asn",
    organizationId: "org1",
    projectId: "p1",
    ...overrides,
  } as ConvexCrewAssignment;
}

describe("mapCallSheetMilestoneDates", () => {
  it("converts epoch-ms milestone fields to Date", () => {
    const t = Date.UTC(2026, 5, 1);
    const result = mapCallSheetMilestoneDates(
      project({ loadInDate: t, eventStartDate: t + 1, eventEndDate: t + 2, loadOutDate: t + 3 }),
    );
    expect(result.loadInDate).toEqual(new Date(t));
    expect(result.eventStartDate).toEqual(new Date(t + 1));
    expect(result.eventEndDate).toEqual(new Date(t + 2));
    expect(result.loadOutDate).toEqual(new Date(t + 3));
  });

  it("maps absent milestone fields to null", () => {
    const result = mapCallSheetMilestoneDates(project());
    expect(result.loadInDate).toBeNull();
    expect(result.eventStartDate).toBeNull();
    expect(result.eventEndDate).toBeNull();
    expect(result.loadOutDate).toBeNull();
  });
});

describe("buildCallSheetServiceDates", () => {
  it("drops CANCELLED services (Prisma where status != CANCELLED)", () => {
    const t = Date.UTC(2026, 0, 1);
    const result = buildCallSheetServiceDates(
      [
        service({ id: "ok", date: t, status: "CONFIRMED" }),
        service({ id: "cancelled", date: t + 1, status: "CANCELLED" }),
      ],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].date).toEqual(new Date(t));
  });

  it("drops services with no date (call-site .filter(date != null))", () => {
    const t = Date.UTC(2026, 0, 1);
    const result = buildCallSheetServiceDates(
      [service({ id: "dated", date: t }), service({ id: "undated", date: undefined })],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].date).toEqual(new Date(t));
  });

  it("counts crew assignments per service via serviceId (_count crewAssignments)", () => {
    const t = Date.UTC(2026, 0, 1);
    const result = buildCallSheetServiceDates(
      [service({ id: "svc1", date: t }), service({ id: "svc2", date: t + 1 })],
      [
        assignment({ id: "a1", serviceId: "svc1" }),
        assignment({ id: "a2", serviceId: "svc1" }),
        assignment({ id: "a3", serviceId: "svc2" }),
        assignment({ id: "a4", serviceId: undefined }), // unlinked — not counted
        assignment({ id: "a5", serviceId: "other" }), // other service — not counted
      ],
    );
    expect(result.find((r) => r.date.getTime() === t)?.crewCount).toBe(2);
    expect(result.find((r) => r.date.getTime() === t + 1)?.crewCount).toBe(1);
  });

  it("returns crewCount 0 for a service with no assignments", () => {
    const t = Date.UTC(2026, 0, 1);
    const result = buildCallSheetServiceDates([service({ id: "svc1", date: t })], []);
    expect(result[0].crewCount).toBe(0);
  });

  it("orders ascending by date (Prisma orderBy date asc)", () => {
    const a = Date.UTC(2026, 0, 3);
    const b = Date.UTC(2026, 0, 1);
    const c = Date.UTC(2026, 0, 2);
    const result = buildCallSheetServiceDates(
      [service({ id: "a", date: a }), service({ id: "b", date: b }), service({ id: "c", date: c })],
      [],
    );
    expect(result.map((r) => r.date.getTime())).toEqual([b, c, a]);
  });

  it("converts epoch-ms service date to Date", () => {
    const t = Date.UTC(2026, 5, 15);
    const result = buildCallSheetServiceDates([service({ date: t })], []);
    expect(result[0].date).toEqual(new Date(t));
    expect(result[0].date).toBeInstanceOf(Date);
  });
});
