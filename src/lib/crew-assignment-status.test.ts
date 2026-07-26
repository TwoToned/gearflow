import { describe, expect, it } from "vitest";
import { isFilledAssignmentStatus, NON_FILLED_ASSIGNMENT_STATUSES } from "./crew-assignment-status";

describe("isFilledAssignmentStatus", () => {
  it("excludes DECLINED and CANCELLED — the bug this fixes (services-panel.tsx)", () => {
    expect(isFilledAssignmentStatus("DECLINED")).toBe(false);
    expect(isFilledAssignmentStatus("CANCELLED")).toBe(false);
  });

  it("counts every other assignment status as filled", () => {
    for (const s of ["PENDING", "OFFERED", "ACCEPTED", "CONFIRMED", "COMPLETED"]) {
      expect(isFilledAssignmentStatus(s)).toBe(true);
    }
  });

  it("treats a missing status as filled (legacy rows predate the status field)", () => {
    expect(isFilledAssignmentStatus(null)).toBe(true);
    expect(isFilledAssignmentStatus(undefined)).toBe(true);
  });

  it("NON_FILLED_ASSIGNMENT_STATUSES is exactly {DECLINED, CANCELLED}", () => {
    expect([...NON_FILLED_ASSIGNMENT_STATUSES].sort()).toEqual(["CANCELLED", "DECLINED"]);
  });
});
