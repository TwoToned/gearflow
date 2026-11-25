import { describe, expect, it } from "vitest";
import { isOpenMaintenance, isOverdueMaintenance, maintenanceTileCounts } from "./maintenanceOpen";

const NOW = Date.UTC(2026, 10, 24);
const DAY = 86_400_000;

describe("maintenanceTileCounts — the Maintenance page's four tiles", () => {
  it("open counts every open status (awaiting parts and QA too); overdue only scheduled / in progress past the date", () => {
    const rows = [
      { status: "SCHEDULED", scheduledDate: NOW - DAY },
      { status: "SCHEDULED", scheduledDate: NOW + DAY },
      { status: "AWAITING_PARTS", scheduledDate: NOW - DAY },
      { status: "IN_PROGRESS", scheduledDate: NOW - DAY },
      { status: "QA" },
      { status: "COMPLETED", scheduledDate: NOW - DAY, completedDate: NOW - DAY },
      { status: "COMPLETED", completedDate: NOW - 40 * DAY },
      { status: "CANCELLED", scheduledDate: NOW - DAY },
    ];
    expect(maintenanceTileCounts(rows, NOW, NOW - 10 * DAY)).toEqual({ open: 5, overdue: 2, inProgress: 1, completedSince: 1 });
  });

  it("an absent status is NOT open and never overdue (the server's status-index reads can't see it either)", () => {
    expect(isOpenMaintenance(undefined)).toBe(false);
    expect(isOpenMaintenance(null)).toBe(false);
    expect(isOverdueMaintenance({ scheduledDate: NOW - DAY }, NOW)).toBe(false);
    expect(maintenanceTileCounts([{ scheduledDate: NOW - DAY }, { status: null }], NOW, 0)).toEqual({ open: 0, overdue: 0, inProgress: 0, completedSince: 0 });
  });

  it("Overdue is about the scheduled DAY: today at any hour (even its first instant) is not overdue, the last instant of yesterday is", () => {
    const afternoon = NOW + 15 * 60 * 60 * 1000; // 15:00 on the day NOW starts
    const overdue = (scheduledDate: number, at = afternoon) => isOverdueMaintenance({ status: "SCHEDULED", scheduledDate }, at);
    expect(overdue(NOW)).toBe(false); // rescheduled to today, midnight: due, not overdue
    expect(overdue(NOW + 3_600_000)).toBe(false);
    expect(overdue(afternoon - 1)).toBe(false);
    expect(overdue(NOW - 1)).toBe(true); // 23:59:59.999 yesterday
    expect(overdue(NOW - DAY)).toBe(true);
    expect(overdue(NOW + DAY, NOW + DAY)).toBe(false); // read at the start of the NEXT day, that day's own date is still today
    expect(overdue(NOW, NOW + DAY)).toBe(true); // ...and the day before is overdue once the next day starts
  });

  it("a date exactly now is not yet overdue", () => {
    expect(maintenanceTileCounts([{ status: "SCHEDULED", scheduledDate: NOW }], NOW, 0).overdue).toBe(0);
  });
});
