import { describe, it, expect } from "vitest";
import { resolvePrimaryDateRange } from "./project-dates";

const iso = (s: string) => new Date(s).toISOString();

describe("resolvePrimaryDateRange", () => {
  it("prefers the project window — what a human means by 'when is this job'", () => {
    expect(
      resolvePrimaryDateRange({
        projectStartDate: "2026-08-01T09:00:00Z",
        projectEndDate: "2026-08-03T22:00:00Z",
        rentalStartDate: "2026-07-30T00:00:00Z",
        rentalEndDate: "2026-08-05T00:00:00Z",
      }),
    ).toEqual({
      start: iso("2026-08-01T09:00:00Z"),
      end: iso("2026-08-03T22:00:00Z"),
      source: "project",
    });
  });

  it("falls back to the rental window when there is no project window", () => {
    expect(
      resolvePrimaryDateRange({
        rentalStartDate: "2026-07-30T00:00:00Z",
        rentalEndDate: "2026-08-05T00:00:00Z",
      }),
    ).toEqual({
      start: iso("2026-07-30T00:00:00Z"),
      end: iso("2026-08-05T00:00:00Z"),
      source: "rental",
    });
  });

  it("reports source 'none' for an undated project instead of guessing", () => {
    expect(resolvePrimaryDateRange({})).toEqual({ start: null, end: null, source: "none" });
    expect(resolvePrimaryDateRange({ projectStartDate: null, rentalStartDate: undefined })).toEqual({
      start: null,
      end: null,
      source: "none",
    });
  });

  it("never straddles two meanings: the end comes from the same pair as the start", () => {
    // Project start but no project end, with a rental end present. The rental end
    // must NOT be spliced onto the project start — that range would mean nothing.
    const r = resolvePrimaryDateRange({
      projectStartDate: "2026-08-01T09:00:00Z",
      rentalEndDate: "2026-08-05T00:00:00Z",
    });
    expect(r.source).toBe("project");
    expect(r.end).toBe(iso("2026-08-01T09:00:00Z")); // single-day, not the rental end
  });

  it("treats a single-day job as end === start, not a null end", () => {
    const r = resolvePrimaryDateRange({ projectStartDate: "2026-08-01T09:00:00Z" });
    expect(r.start).toBe(r.end);
  });

  it("skips a pair whose start is missing even if its end is set", () => {
    const r = resolvePrimaryDateRange({
      projectEndDate: "2026-08-03T00:00:00Z",
      rentalStartDate: "2026-07-30T00:00:00Z",
      rentalEndDate: "2026-08-05T00:00:00Z",
    });
    expect(r.source).toBe("rental");
  });

  it("accepts Date objects, epoch millis, and ISO strings alike", () => {
    const target = iso("2026-08-01T09:00:00Z");
    const asDate = resolvePrimaryDateRange({ projectStartDate: new Date("2026-08-01T09:00:00Z") });
    const asEpoch = resolvePrimaryDateRange({
      projectStartDate: new Date("2026-08-01T09:00:00Z").getTime(),
    });
    const asString = resolvePrimaryDateRange({ projectStartDate: "2026-08-01T09:00:00Z" });
    expect([asDate.start, asEpoch.start, asString.start]).toEqual([target, target, target]);
  });

  it("ignores an unparseable date rather than emitting Invalid Date", () => {
    const r = resolvePrimaryDateRange({
      projectStartDate: "not a date",
      rentalStartDate: "2026-07-30T00:00:00Z",
    });
    expect(r.source).toBe("rental");
    expect(r.start).toBe(iso("2026-07-30T00:00:00Z"));
  });
});
