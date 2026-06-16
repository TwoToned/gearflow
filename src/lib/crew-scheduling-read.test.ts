import { describe, it, expect } from "vitest";
import { mapAssignment, mapTimeEntry, mapShift, mapCertification } from "@/lib/crew-scheduling-read";

describe("crew-scheduling-read mappers", () => {
  it("mapAssignment converts dates and normalises absent optionals", () => {
    const m = mapAssignment({
      id: "a1", organizationId: "o", projectId: "p", crewMemberId: "m", status: "CONFIRMED",
      isProjectManager: true, startDate: 1_700_000_000_000,
      // crewRoleId / phase / endDate / createdAt absent
    } as never);
    expect(m.startDate).toBeInstanceOf(Date);
    expect(m.startDate?.getTime()).toBe(1_700_000_000_000);
    expect(m.endDate).toBeNull();
    expect(m.crewRoleId).toBeNull();
    expect(m.phase).toBeNull();
    expect(m.isProjectManager).toBe(true);
    expect(m.status).toBe("CONFIRMED");
  });

  it("mapAssignment defaults isProjectManager to false when absent", () => {
    const m = mapAssignment({ id: "a", organizationId: "o", projectId: "p", crewMemberId: "m", status: "PENDING" } as never);
    expect(m.isProjectManager).toBe(false);
  });

  it("mapTimeEntry converts date and keeps numeric totalHours; null when absent", () => {
    const withHours = mapTimeEntry({
      id: "t", organizationId: "o", crewMemberId: "m", date: 1_700_000_000_000,
      startTime: "08:00", endTime: "16:00", status: "APPROVED", totalHours: 7.5, assignmentId: "a",
    } as never);
    expect(withHours.date).toBeInstanceOf(Date);
    expect(withHours.totalHours).toBe(7.5);
    expect(withHours.assignmentId).toBe("a");
    expect(withHours.breakMinutes).toBe(0); // absent → default 0
    expect(withHours.approvedAt).toBeNull();
    expect(withHours.approvedById).toBeNull();

    const noHours = mapTimeEntry({
      id: "t2", organizationId: "o", crewMemberId: "m", date: 1, startTime: "08:00", endTime: "16:00", status: "SUBMITTED",
    } as never);
    expect(noHours.totalHours).toBeNull();
    expect(noHours.assignmentId).toBeNull();
    expect(noHours.description).toBeNull();
  });

  it("mapShift converts date and normalises call/end times", () => {
    const m = mapShift({ id: "s", assignmentId: "a", date: 1_700_000_000_000, status: "SCHEDULED", callTime: "08:00" } as never);
    expect(m.date.getTime()).toBe(1_700_000_000_000);
    expect(m.callTime).toBe("08:00");
    expect(m.endTime).toBeNull();
  });

  it("mapCertification reduces to id/member/status", () => {
    const m = mapCertification({ id: "c", crewMemberId: "m", status: "EXPIRED", name: "X" } as never);
    expect(m).toEqual({ id: "c", crewMemberId: "m", status: "EXPIRED" });
  });
});
