import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UX Phase 15 (D49, Q-I9): the timesheet CSV's Rate (pay) / Total columns are
 * decided on the SERVER — a signed-in manager+ gets them, anyone below manager
 * and any API-key actor does not — and the day rate counts once per day.
 */
const role = { value: "manager" as string | null };
const ambient = { value: undefined as unknown };

vi.mock("@/lib/org-context", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org1", userId: "u1", userName: "Alice" })),
  getCurrentRole: vi.fn(async () => role.value),
}));
vi.mock("@/lib/request-actor", () => ({ getAmbientActor: vi.fn(() => ambient.value) }));
vi.mock("@/lib/crew-read", () => ({
  getCrewMembersByOrg: vi.fn(async () => [{ id: "c1", firstName: "Bob", lastName: "Ryan", email: "bob@x.com" }]),
  getCrewRoleMap: vi.fn(async () => new Map([["r1", { id: "r1", name: "Rigger" }]])),
}));
vi.mock("@/lib/projects-read", () => ({
  getProjectsByOrg: vi.fn(async () => [{ id: "p1", projectNumber: "2341", name: "Launch" }]),
}));
const D0 = new Date(Date.UTC(2026, 10, 16));
vi.mock("@/lib/crew-scheduling-read", () => ({
  getAssignmentsByOrg: vi.fn(async () => [{ id: "a1", projectId: "p1", crewRoleId: "r1", rateOverride: 650, rateType: "DAILY" }]),
  getTimeEntriesByOrg: vi.fn(async () => [
    { id: "t1", crewMemberId: "c1", assignmentId: "a1", description: null, date: D0, startTime: "07:00", endTime: "12:00", breakMinutes: 0, totalHours: 5, status: "DISPUTED", queryReason: "Was it 4h?" },
    { id: "t2", crewMemberId: "c1", assignmentId: "a1", description: null, date: D0, startTime: "13:00", endTime: "17:00", breakMinutes: 0, totalHours: 4, status: "SUBMITTED" },
  ]),
}));

import { exportTimesheetCSV } from "../crew-time";

describe("exportTimesheetCSV — pay columns are server-gated", () => {
  beforeEach(() => {
    role.value = "manager";
    ambient.value = undefined;
  });

  it("manager: Rate (pay) and Total, the day rate once, Query reason present", async () => {
    const lines = (await exportTimesheetCSV()).split("\n");
    expect(lines[0].endsWith("Status,Query reason,Rate (pay),Total")).toBe(true);
    expect(lines[1]).toContain("Bob Ryan");
    expect(lines[1].endsWith(",DISPUTED,Was it 4h?,650,650")).toBe(true);
    expect(lines[2].endsWith(",SUBMITTED,,650,incl.")).toBe(true);
  });

  it("below manager: no pay columns at all", async () => {
    role.value = "member";
    const csv = await exportTimesheetCSV();
    expect(csv).not.toContain("Rate (pay)");
    expect(csv).not.toContain("650");
  });

  it("an API-key actor gets no pay columns, even as an owner", async () => {
    role.value = "owner";
    ambient.value = { organizationId: "org1", userId: "u1", userName: "Alice", actorType: "apiKey" };
    expect(await exportTimesheetCSV()).not.toContain("Rate (pay)");
  });

  it("bulk Export: ids narrow to the ticked rows, and the carried day rate still reads incl.", async () => {
    const lines = (await exportTimesheetCSV({ ids: ["t2"] })).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith(",SUBMITTED,,650,incl.")).toBe(true);
  });

  it("the filters are a validated trust boundary", async () => {
    await expect(exportTimesheetCSV({ ids: [] })).rejects.toThrow();
    await expect(exportTimesheetCSV({ ids: Array.from({ length: 501 }, (_, i) => `t${i}`) })).rejects.toThrow();
  });
});
