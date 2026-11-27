import { describe, expect, it } from "vitest";

import {
  barFor,
  clashWord,
  dayFacts,
  jobHold,
  jobsOnDay,
  rangeQueryMs,
  scheduleRange,
  shownJobs,
  stepRange,
  stripCounts,
  type FilterContext,
  type ScheduleFilters,
  type ScheduleJob,
} from "@/lib/schedule";
import { parseCell, parseScheduleView, segmentFor, viewPatch } from "@/lib/schedule-url";

const ms = (key: string) => Date.parse(`${key}T00:00:00.000Z`);

function job(id: string, from: string, to: string, over: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id, projectNumber: `#${id}`, name: `Job ${id}`, status: "CONFIRMED", holds: true, clientId: null, clientName: null,
    projectManagerId: null, rentalStart: ms(from), rentalEnd: ms(to), windowStart: null, windowEnd: null, clash: "none", clashes: [], modelCount: 1, modelIds: ["m1"],
    lineCount: 1, unitCount: 1, ...over,
  };
}

const ctx: FilterContext = { modelName: (id) => (id === "m1" ? "EM4 receiver" : id), modelCategory: () => "cat1" };
const noFilters: ScheduleFilters = { seg: "all", q: "", status: [], pm: [], category: [], model: [] };

describe("the range", () => {
  it("is a real calendar month (D83): 30 columns in November, 29 in Feb 2028", () => {
    expect(scheduleRange("month", "2026-11-14", 1).days).toHaveLength(30);
    expect(scheduleRange("month", "2026-11-14", 1).start).toBe("2026-11-01");
    expect(scheduleRange("month", "2028-02-10", 1).days).toHaveLength(29);
  });

  it("opens a week on the ORG's week start", () => {
    // 2026-11-11 is a Wednesday.
    expect(scheduleRange("week", "2026-11-11", 1).start).toBe("2026-11-09");
    expect(scheduleRange("week", "2026-11-11", 0).start).toBe("2026-11-08");
  });

  it("steps a week by 7 days and a month by a calendar month, across a year", () => {
    expect(stepRange(scheduleRange("week", "2026-11-11", 1), 1, "2026-11-11", 1)).toBe("2026-11-16");
    expect(stepRange(scheduleRange("month", "2026-12-05", 1), 1, "2026-11-11", 1)).toBe("2027-01-01");
    expect(stepRange(scheduleRange("month", "2027-01-05", 1), -1, "2026-11-11", 1)).toBe("2026-12-01");
  });

  it("queries first day 00:00 UTC to the last day's last millisecond", () => {
    const r = scheduleRange("week", "2026-11-11", 1);
    const q = rangeQueryMs(r);
    expect(q.startMs).toBe(ms("2026-11-09"));
    expect(q.endMs).toBe(ms("2026-11-15") + 86_400_000 - 1);
  });
});

describe("bars and days", () => {
  const days = scheduleRange("week", "2026-11-11", 1).days;

  it("clamps a job that continues past the range and squares that edge", () => {
    expect(barFor(job("a", "2026-11-05", "2026-11-11"), days)).toEqual({ col: 0, span: 3, capStart: false, capEnd: true });
    expect(barFor(job("b", "2026-11-14", "2026-11-20"), days)).toEqual({ col: 5, span: 2, capStart: true, capEnd: false });
    expect(barFor(job("c", "2026-11-20", "2026-11-21"), days)).toBeNull();
  });

  it("puts every job of a month on at least one day (the phone day list loses no job the old Agenda showed)", () => {
    const month = scheduleRange("month", "2026-11-11", 1).days;
    const jobs = [job("a", "2026-10-28", "2026-11-02"), job("b", "2026-11-15", "2026-11-15"), job("c", "2026-11-29", "2026-12-03")];
    const seen = new Set(month.flatMap((d) => jobsOnDay(jobs, d).map((j) => j.id)));
    expect([...seen].sort()).toEqual(["a", "b", "c"]);
  });

  it("marks a day red only on the days of the run, not the whole bar", () => {
    const j = job("a", "2026-11-09", "2026-11-13", {
      clash: "clash",
      clashes: [{ layer: "hard", modelId: "m1", modelName: "EM4", short: 1, startMs: ms("2026-11-11"), endMs: ms("2026-11-11"), with: [] }],
    });
    const facts = dayFacts([j], days);
    expect(facts.filter((f) => f.clash).map((f) => f.day)).toEqual(["2026-11-11"]);
    expect(facts[0].count).toBe(1);
  });
});

describe("words, strip, filters", () => {
  const held = job("h", "2026-11-09", "2026-11-10", { clash: "clash" });
  const pencilled = job("p", "2026-11-09", "2026-11-10", { status: "QUOTED", holds: false, clash: "wouldClash" });
  const done = job("d", "2026-11-09", "2026-11-10", { status: "RETURNED", holds: false });
  const unknown = job("u", "2026-11-09", "2026-11-10", { clash: "unknown" });

  it("one word per state; an unchecked job is never read as no clash", () => {
    expect(clashWord(held)?.label).toBe("clash");
    expect(clashWord(pencilled)?.label).toBe("would clash");
    expect(clashWord(unknown)?.label).toBe("not checked");
    expect(clashWord(job("n", "2026-11-09", "2026-11-09"))).toBeNull();
  });

  it("holds / pencilled / done", () => {
    expect([held, pencilled, done].map(jobHold)).toEqual(["held", "pencilled", "done"]);
  });

  it("strip counts follow the filters, and Clashes counts held clashes only", () => {
    expect(stripCounts([held, pencilled, done, unknown])).toEqual({ all: 4, confirmed: 2, pencilled: 1, clashes: 1 });
  });

  it("the strip narrows what is drawn but not what the strip counts", () => {
    const r = shownJobs([held, pencilled, done], { ...noFilters, seg: "pencilled" }, ctx);
    expect(r.filtered).toHaveLength(3);
    expect(r.shown.map((j) => j.id)).toEqual(["p"]);
  });

  it("searches job number, name, client and model", () => {
    const withClient = job("c", "2026-11-09", "2026-11-10", { clientName: "Hilton Sydney" });
    expect(shownJobs([withClient, held], { ...noFilters, q: "hilton" }, ctx).shown.map((j) => j.id)).toEqual(["c"]);
    expect(shownJobs([withClient, held], { ...noFilters, q: "em4" }, ctx).shown).toHaveLength(2);
    expect(shownJobs([withClient, held], { ...noFilters, q: "#h" }, ctx).shown.map((j) => j.id)).toEqual(["h"]);
  });

  it("filters by status and PM", () => {
    const mine = job("m", "2026-11-09", "2026-11-10", { projectManagerId: "u1" });
    expect(shownJobs([mine, held], { ...noFilters, pm: ["u1"] }, ctx).shown.map((j) => j.id)).toEqual(["m"]);
    expect(shownJobs([pencilled, held], { ...noFilters, status: ["QUOTED"] }, ctx).shown.map((j) => j.id)).toEqual(["p"]);
  });
});

describe("the URL", () => {
  it("defaults are plain: no params open this week", () => {
    const v = parseScheduleView(new URLSearchParams(), "2026-11-11", 1);
    expect(v).toEqual({ zoom: "week", anchor: "2026-11-09", day: null, job: null, cell: null });
    expect(viewPatch({}, v, "2026-11-11", 1)).toEqual({ zoom: null, date: null, day: null, job: null, cell: null });
  });

  it("normalises a deep link date (the ⌘K row) to its week or month and drops junk", () => {
    expect(parseScheduleView(new URLSearchParams("date=2026-11-12"), "2026-11-11", 1).anchor).toBe("2026-11-09");
    expect(parseScheduleView(new URLSearchParams("zoom=month&date=2026-11-12"), "2026-11-11", 1).anchor).toBe("2026-11-01");
    const junk = parseScheduleView(new URLSearchParams("zoom=year&date=nope&day=2026-13-40&job="), "2026-11-11", 1);
    expect(junk).toEqual({ zoom: "week", anchor: "2026-11-09", day: null, job: null, cell: null });
  });

  it("writes a non-default month and the open sheets", () => {
    const v = parseScheduleView(new URLSearchParams(), "2026-11-11", 1);
    expect(viewPatch({ zoom: "month", anchor: "2026-12-01", day: "2026-12-03" }, v, "2026-11-11", 1)).toEqual({
      zoom: "month", date: "2026-12-01", day: "2026-12-03", job: null, cell: null,
    });
  });
});

describe("the Gear URL", () => {
  it("reads a cell and drops a junk one; a strip word from the other view reads as all", () => {
    const v = parseScheduleView(new URLSearchParams("cell=mdl_1:2026-11-11"), "2026-11-11", 1);
    expect(parseCell(v.cell)).toEqual({ modelId: "mdl_1", day: "2026-11-11" });
    expect(parseScheduleView(new URLSearchParams("cell=nope"), "2026-11-11", 1).cell).toBeNull();
    expect(parseCell(null)).toBeNull();
    expect(segmentFor("gear", "short")).toBe("short");
    expect(segmentFor("gear", "clashes")).toBe("all");
    expect(segmentFor("jobs", "atrisk")).toBe("all");
  });
});
