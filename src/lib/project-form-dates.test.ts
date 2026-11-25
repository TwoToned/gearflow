import { describe, it, expect } from "vitest";
import { normalizeDate, resolveWindowMs, shiftWindowWithRental, toDateStr, fromDateStr } from "./project-form-dates";

describe("shiftWindowWithRental (D25)", () => {
  const before = { rentalStartDate: "2026-12-10", rentalEndDate: "2026-12-12" };

  it("moves a set window by the same offset when the rental moves", () => {
    const out = shiftWindowWithRental(before, {
      rentalStartDate: "2026-12-17", rentalEndDate: "2026-12-19",
      projectStartDate: "2026-12-09", projectEndDate: "2026-12-13",
    });
    expect(out).toEqual({ projectStartDate: "2026-12-16", projectEndDate: "2026-12-20" });
  });

  it("moves backwards, across a month and a year", () => {
    const out = shiftWindowWithRental(
      { rentalStartDate: "2027-01-02", rentalEndDate: "2027-01-03" },
      { rentalStartDate: "2026-12-30", rentalEndDate: "2026-12-31", projectStartDate: "2027-01-01", projectEndDate: "2027-01-04" },
    );
    expect(out).toEqual({ projectStartDate: "2026-12-29", projectEndDate: "2027-01-01" });
  });

  it("leaves a blank window blank (it means same as rental)", () => {
    const out = shiftWindowWithRental(before, { rentalStartDate: "2026-12-17", rentalEndDate: "2026-12-19" });
    expect(out).toEqual({ projectStartDate: undefined, projectEndDate: undefined });
  });

  it("an unmoved rental changes nothing", () => {
    const out = shiftWindowWithRental(before, { ...before, projectStartDate: "2026-12-09", projectEndDate: "2026-12-13" });
    expect(out).toEqual({ projectStartDate: "2026-12-09", projectEndDate: "2026-12-13" });
  });

  it("a one-sided change moves only that side, keeping the padding", () => {
    const out = shiftWindowWithRental(before, {
      rentalStartDate: "2026-12-10", rentalEndDate: "2026-12-14",
      projectStartDate: "2026-12-09", projectEndDate: "2026-12-13",
    });
    expect(out).toEqual({ projectStartDate: "2026-12-09", projectEndDate: "2026-12-15" });
  });

  it("clearing or first-setting the rental leaves the window alone", () => {
    const win = { projectStartDate: "2026-12-09", projectEndDate: "2026-12-13" };
    expect(shiftWindowWithRental(before, { rentalStartDate: "", rentalEndDate: "", ...win })).toEqual(win);
    expect(shiftWindowWithRental({}, { rentalStartDate: "2026-12-17", rentalEndDate: "2026-12-19", ...win })).toEqual(win);
  });

  it("counts calendar days across a daylight-saving change", () => {
    const out = shiftWindowWithRental(
      { rentalStartDate: "2026-10-03", rentalEndDate: "2026-10-04" },
      { rentalStartDate: "2026-10-10", rentalEndDate: "2026-10-11", projectStartDate: "2026-10-03", projectEndDate: "2026-10-05" },
    );
    expect(out).toEqual({ projectStartDate: "2026-10-10", projectEndDate: "2026-10-12" });
  });
});

describe("date helpers", () => {
  it("round-trips the form string and rejects junk", () => {
    expect(toDateStr(fromDateStr("2026-12-01"))).toBe("2026-12-01");
    expect(normalizeDate("nope")).toBeUndefined();
    expect(normalizeDate(undefined)).toBeUndefined();
  });

  it("resolves the gear window with the project window winning per side", () => {
    const w = resolveWindowMs({ rentalStartDate: "2026-12-10", rentalEndDate: "2026-12-12", projectStartDate: "2026-12-09" });
    expect(w.start).toBe(fromDateStr("2026-12-09")!.getTime());
    expect(w.end).toBe(fromDateStr("2026-12-12")!.getTime());
    expect(resolveWindowMs({})).toEqual({ start: null, end: null });
  });
});
