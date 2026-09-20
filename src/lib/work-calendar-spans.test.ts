import { describe, it, expect } from "vitest";
import { spanDays, isSpan, spanCaption, daysBetween, MAX_SPAN_DAYS } from "./work-calendar-spans";

const item = (startDate: string | null, dueDate: string | null) => ({ id: "t", startDate, dueDate });

describe("spanDays", () => {
  it("puts an undated item nowhere", () => {
    expect(spanDays(item(null, null))).toEqual([]);
  });

  it("puts a due-date-only item on exactly one day", () => {
    expect(spanDays(item(null, "2026-10-14"))).toEqual([{ day: "2026-10-14", position: "point" }]);
  });

  it("walks every day of a span, marking the ends", () => {
    expect(spanDays(item("2026-10-12", "2026-10-15"))).toEqual([
      { day: "2026-10-12", position: "start" },
      { day: "2026-10-13", position: "middle" },
      { day: "2026-10-14", position: "middle" },
      { day: "2026-10-15", position: "end" },
    ]);
  });

  it("crosses a month boundary", () => {
    expect(spanDays(item("2026-10-30", "2026-11-01")).map((d) => d.day)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  // Melbourne springs forward on 2026-10-04. Calendar arithmetic can't skip it;
  // adding 24h to an instant could.
  it("does not skip or repeat a day across a DST transition", () => {
    expect(spanDays(item("2026-10-03", "2026-10-06")).map((d) => d.day)).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
  });

  it("collapses a same-day span to one point, not two rows on one day", () => {
    expect(spanDays(item("2026-10-14", "2026-10-14"))).toEqual([{ day: "2026-10-14", position: "point" }]);
  });

  // The writer rejects this, but a row stored before the guard existed could
  // carry it. A renderer must make it look wrong, not take the tab down.
  it("collapses a backwards span to its due date instead of throwing", () => {
    expect(spanDays(item("2026-11-30", "2026-10-14"))).toEqual([{ day: "2026-10-14", position: "point" }]);
  });

  it("caps a very long span but always keeps both ends", () => {
    const days = spanDays(item("2026-01-01", "2026-12-31"));
    expect(days).toHaveLength(MAX_SPAN_DAYS);
    expect(days[0]).toEqual({ day: "2026-01-01", position: "start" });
    // The deadline is the one day a reader must not lose to truncation.
    expect(days[days.length - 1]).toEqual({ day: "2026-12-31", position: "end" });
  });
});

describe("isSpan", () => {
  it("is true only when the item runs over more than one day", () => {
    expect(isSpan(item("2026-10-12", "2026-10-14"))).toBe(true);
    expect(isSpan(item("2026-10-14", "2026-10-14"))).toBe(false);
    expect(isSpan(item(null, "2026-10-14"))).toBe(false);
    expect(isSpan(item("2026-10-12", null))).toBe(false);
  });
});

describe("spanCaption", () => {
  const plain = (d: string) => d;

  it("counts the day within the span, inclusive of both ends", () => {
    expect(spanCaption(item("2026-10-12", "2026-10-14"), "2026-10-13", plain)).toBe(
      "2026-10-12 → 2026-10-14 · day 2 of 3",
    );
    expect(spanCaption(item("2026-10-12", "2026-10-14"), "2026-10-14", plain)).toMatch(/day 3 of 3/);
  });

  it("says nothing for a point — there is no span to describe", () => {
    expect(spanCaption(item(null, "2026-10-14"), "2026-10-14", plain)).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts whole days across month, year and DST boundaries", () => {
    expect(daysBetween("2026-10-12", "2026-10-14")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-03", "2026-10-06")).toBe(3); // spans a DST shift
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // leap year
  });
});
