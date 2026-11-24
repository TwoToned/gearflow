import { describe, expect, it } from "vitest";
import { maintenanceTileCounts } from "./maintenanceOpen";

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

  it("a date exactly now is not yet overdue", () => {
    expect(maintenanceTileCounts([{ status: "SCHEDULED", scheduledDate: NOW }], NOW, 0).overdue).toBe(0);
  });
});
