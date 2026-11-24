import { describe, expect, test } from "vitest";
import { assignmentCoversDay, crewShortfallByDay, serviceDays } from "./crewShortfall";

const DAY = 86_400_000;
const MON = Date.UTC(2026, 10, 16);
const TUE = MON + DAY;
const WED = MON + 2 * DAY;
/** A Mon–Wed run that needs one person every day. */
const RUN = { date: MON, endDate: WED, crewCountRequired: 1 };

describe("crewShortfallByDay (B1: the shortfall is PER DAY)", () => {
  test("a Mon-only call on a Mon–Wed run leaves Tue and Wed short", () => {
    const gap = crewShortfallByDay(RUN, [{ status: "OFFERED", startDate: MON, endDate: MON }])!;
    expect(gap.shortDays).toEqual([
      { day: TUE, shortfall: 1 },
      { day: WED, shortfall: 1 },
    ]);
    expect(gap).toMatchObject({ required: 1, filled: 0, shortfall: 1 });
  });

  test("a whole-run call fills every day", () => {
    const gap = crewShortfallByDay(RUN, [{ status: "PENDING", startDate: MON, endDate: WED }])!;
    expect(gap).toEqual({ required: 1, filled: 1, shortfall: 0, shortDays: [] });
  });

  test("a call with no dates fills the whole run (the pre-dates shape)", () => {
    expect(crewShortfallByDay(RUN, [{ status: "CONFIRMED" }])!.shortDays).toEqual([]);
  });

  test("declined and cancelled calls fill nothing", () => {
    const gap = crewShortfallByDay(RUN, [
      { status: "DECLINED", startDate: MON, endDate: WED },
      { status: "CANCELLED", startDate: MON, endDate: WED },
    ])!;
    expect(gap.shortDays.map((d) => d.day)).toEqual([MON, TUE, WED]);
  });

  test("the worst day decides: two people on Mon and one on Tue of a need-2 run is short 1 on Tue only", () => {
    const gap = crewShortfallByDay({ date: MON, endDate: TUE, crewCountRequired: 2 }, [
      { status: "CONFIRMED", startDate: MON, endDate: TUE },
      { status: "CONFIRMED", startDate: MON, endDate: MON },
    ])!;
    expect(gap).toEqual({ required: 2, filled: 1, shortfall: 1, shortDays: [{ day: TUE, shortfall: 1 }] });
  });

  test("times inside a day still count the whole UTC day", () => {
    expect(assignmentCoversDay({ startDate: TUE + 9 * 3_600_000 }, TUE)).toBe(true);
    expect(assignmentCoversDay({ startDate: TUE + 9 * 3_600_000 }, WED)).toBe(false);
  });

  test("no stated requirement is never a gap", () => {
    expect(crewShortfallByDay({ ...RUN, crewCountRequired: 0 }, [])).toBeNull();
    expect(crewShortfallByDay({ ...RUN, crewCountRequired: null }, [])).toBeNull();
  });

  test("a dateless service uses the whole-service count and names no days", () => {
    expect(crewShortfallByDay({ crewCountRequired: 2 }, [{ status: "CONFIRMED", startDate: MON }])).toEqual({
      required: 2,
      filled: 1,
      shortfall: 1,
      shortDays: [],
    });
  });

  test("serviceDays lists the run's UTC days", () => {
    expect(serviceDays(RUN)).toEqual([MON, TUE, WED]);
    expect(serviceDays({ date: MON })).toEqual([MON]);
    expect(serviceDays({})).toEqual([]);
  });
});
