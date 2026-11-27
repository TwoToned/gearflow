import { describe, expect, it } from "vitest";

import type { ScheduleJob } from "@/lib/schedule";
import { confirmSkipReason, moveDates, moveSkipReason } from "@/lib/schedule-move";

const st = (status: string): Pick<ScheduleJob, "status"> => ({ status: status as ScheduleJob["status"] });

const ms = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

describe("which jobs a verb applies to", () => {
  it("Confirm applies to a Quoted job only, and names why not otherwise", () => {
    expect(confirmSkipReason(st("QUOTED"))).toBeNull();
    for (const s of ["ENQUIRY", "QUOTING", "CONFIRMED", "PREPPING", "CHECKED_OUT", "CANCELLED"]) expect(confirmSkipReason(st(s))).toBe("not Quoted");
  });

  it("Move dates is refused with the SERVER's reason for gear out and for a finished job, and offered for every other status", () => {
    expect(moveSkipReason(st("CHECKED_OUT"))).toBe("Dates are locked while the gear is out.");
    expect(moveSkipReason(st("ON_SITE"))).toBe("Dates are locked while the gear is out.");
    for (const s of ["RETURNED", "COMPLETED", "INVOICED", "CANCELLED"]) expect(moveSkipReason(st(s))).toBe("A finished job keeps its dates.");
    for (const s of ["ENQUIRY", "QUOTING", "QUOTED", "AWAITING_PAYMENT", "CONFIRMED", "PREPPING"]) expect(moveSkipReason(st(s))).toBeNull();
  });
});

describe("what a date move writes", () => {
  it("moves the rental window by whole calendar days and leaves a blank job window blank", () => {
    const m = moveDates({ rentalStart: ms("2026-11-10"), rentalEnd: ms("2026-11-12"), windowStart: null, windowEnd: null }, 7);
    expect(m.patch).toEqual({ rentalStartDate: "2026-11-17", rentalEndDate: "2026-11-19" });
    expect(m.from).toEqual({ start: "2026-11-10", end: "2026-11-12" });
    expect(m.to).toEqual({ start: "2026-11-17", end: "2026-11-19" });
    // the gate previews the RESOLVED window (rental when the job window is blank)
    expect(m.before).toEqual({ start: ms("2026-11-10"), end: ms("2026-11-12") });
    expect(m.after).toEqual({ start: ms("2026-11-17"), end: ms("2026-11-19") });
  });

  it("carries a SET job window by the same offset, so the load-in and load-out padding is kept", () => {
    const m = moveDates({ rentalStart: ms("2026-11-10"), rentalEnd: ms("2026-11-12"), windowStart: ms("2026-11-09"), windowEnd: ms("2026-11-13") }, -1);
    expect(m.patch).toEqual({ rentalStartDate: "2026-11-09", rentalEndDate: "2026-11-11", projectStartDate: "2026-11-08", projectEndDate: "2026-11-12" });
    expect(m.before).toEqual({ start: ms("2026-11-09"), end: ms("2026-11-13") });
    expect(m.after).toEqual({ start: ms("2026-11-08"), end: ms("2026-11-12") });
  });

  it("crosses a month and a year, and a DST change never shifts a date (UTC calendar days)", () => {
    expect(moveDates({ rentalStart: ms("2026-12-30"), rentalEnd: ms("2027-01-02"), windowStart: null, windowEnd: null }, 7).patch).toEqual({
      rentalStartDate: "2027-01-06", rentalEndDate: "2027-01-09",
    });
    expect(moveDates({ rentalStart: ms("2027-04-02"), rentalEnd: ms("2027-04-04"), windowStart: null, windowEnd: null }, 1).patch.rentalStartDate).toBe("2027-04-03");
  });
});
