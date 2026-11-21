import { describe, expect, it } from "vitest";

import { defaultListState, parseListState } from "@/lib/list-url-state";
import {
  JOBS_SPEC,
  jobFilters,
  jobFlags,
  jobRowOf,
  jobSegments,
  jobsCsv,
  jobsQueryArgs,
  jobsBuiltInViews,
  resolveDatePreset,
} from "./jobs";

const NOW = new Date(2026, 10, 19, 10, 0).getTime(); // Thu 19 Nov 2026, local
const parse = (qs: string) => parseListState(new URLSearchParams(qs), JOBS_SPEC);

describe("jobs segments", () => {
  it("ships seven segments in order, Active (D86) right after All", () => {
    expect(jobSegments(undefined).map((s) => s.label)).toEqual(["All", "Active", "Quoting", "Booked", "Out", "Done", "Needs you"]);
    expect(parse("seg=active").seg).toBe("active");
    // Overdue is a filter (`overdue=1`), never a segment.
    expect(JOBS_SPEC.segments).not.toContain("overdue");
    expect(parse("seg=overdue").seg).toBe("all");
  });

  it("overdue=1 (D86) maps to listPage's overdue arg; anything else is no filter", () => {
    expect(jobsQueryArgs(parse("overdue=1"), NOW).overdue).toBe(true);
    expect(jobsQueryArgs(parse("overdue=1&seg=out"), NOW)).toMatchObject({ overdue: true, segment: "out" });
    expect(jobsQueryArgs(parse("overdue=yes"), NOW).overdue).toBeUndefined();
    expect(jobsQueryArgs(parse(""), NOW).overdue).toBeUndefined();
  });

  it("the overdue filter word reads Returns: Overdue", () => {
    const word = jobFilters([], { value: "", onChange: () => {} }).find((f) => f.key === "overdue");
    expect(word).toMatchObject({ label: "Returns", single: true, options: [{ value: "1", label: "Overdue" }] });
  });

  it("carries counts from segmentCounts", () => {
    const segs = jobSegments({ all: 38, needs: 3 });
    expect(segs.find((s) => s.key === "all")?.count).toBe(38);
    expect(segs.find((s) => s.key === "needs")?.count).toBe(3);
    expect(segs.find((s) => s.key === "out")?.count).toBeUndefined();
  });
});

describe("jobsQueryArgs", () => {
  it("maps the URL to listPage args with page size 25", () => {
    const state = parse("seg=booked&q=%20hilton&status=CONFIRMED,PREPPING&type=TOUR&client=c1&sort=total:desc&page=2");
    expect(jobsQueryArgs(state, NOW)).toMatchObject({
      search: "hilton",
      segment: "booked",
      statusIn: ["CONFIRMED", "PREPPING"],
      typeIn: ["TOUR"],
      clientIn: ["c1"],
      sortBy: "total",
      sortOrder: "desc",
      page: 2,
      pageSize: 25,
      now: NOW,
    });
  });

  it("defaults: all segment, start-date ascending, cancelled hidden", () => {
    const args = jobsQueryArgs(defaultListState(JOBS_SPEC), NOW);
    expect(args).toMatchObject({ segment: "all", sortBy: "rentalStartDate", sortOrder: "asc", page: 1 });
    expect(args.includeCancelled).toBeUndefined();
    expect(args.statusIn).toBeUndefined();
  });

  it("show=cancelled maps to includeCancelled; a date preset resolves from now", () => {
    const args = jobsQueryArgs(parse("show=cancelled&date=next-7"), NOW);
    expect(args.includeCancelled).toBe(true);
    expect(args.dateTo! - args.dateFrom!).toBe(7 * 86400000 - 1);
  });

  it("an unknown date preset resolves to no window", () => {
    expect(resolveDatePreset("bogus", NOW)).toEqual({});
    expect(resolveDatePreset(undefined, NOW)).toEqual({});
  });

  it("this-week runs Monday to Sunday around now", () => {
    const { dateFrom, dateTo } = resolveDatePreset("this-week", NOW);
    expect(new Date(dateFrom!).getDay()).toBe(1);
    expect(NOW).toBeGreaterThanOrEqual(dateFrom!);
    expect(NOW).toBeLessThanOrEqual(dateTo!);
  });
});

describe("jobRowOf", () => {
  const p = {
    id: "p1",
    projectNumber: "P-001",
    name: "Splendour Main Stage",
    status: "CHECKED_OUT",
    type: "FESTIVAL",
    rentalStartDate: new Date(2026, 10, 5).getTime(),
    rentalEndDate: new Date(2026, 10, 9).getTime(),
    total: 12500.5,
    tags: ["festival"],
    client: { name: "Acme" },
  };

  it("maps to a job row: title, client line, tags, Out word, money fact, link", () => {
    const row = jobRowOf(p, {});
    expect(row).toMatchObject({ id: "p1", kind: "job", title: "Splendour Main Stage", subtitle: "Acme", tags: ["festival"], href: "/projects/p1" });
    expect(row.status?.label).toBe("Out");
    expect(row.facts.total).toEqual({ kind: "money", amount: 12500.5 });
    expect(row.facts.dates.kind).toBe("dateRange");
    expect(row.facts.type).toEqual({ kind: "text", label: "Festival" });
  });

  it("a missing total is BLANK money, never $0", () => {
    expect(jobRowOf({ ...p, total: null }, {}).facts.total).toEqual({ kind: "money", amount: null });
  });

  it("partial dates read From / Until; none omits the fact", () => {
    expect(jobRowOf({ ...p, rentalEndDate: null }, {}).facts.dates).toMatchObject({ kind: "text" });
    expect(jobRowOf({ ...p, rentalStartDate: null, rentalEndDate: null }, {}).facts.dates).toBeUndefined();
  });

  it("issue and blocking badges become red dot-word flags", () => {
    expect(jobFlags({ issues: { hasOverbooked: true, hasReducedStock: true }, blocking: 2 })).toEqual([
      { label: "Overbooked", tone: "error" },
      { label: "Blocked 2", tone: "error" },
    ]);
    expect(jobFlags({ issues: { hasOverbooked: false, hasReducedStock: true } })).toEqual([{ label: "Reduced stock", tone: "warning" }]);
    expect(jobFlags({})).toEqual([]);
  });
});

describe("saved-view adapter and export", () => {
  it("ships the built-in views as normalised queries; My jobs needs a user", () => {
    const withUser = jobsBuiltInViews("u1");
    expect(withUser.map((b) => b.name)).toEqual(["My jobs", "Out this week", "Unquoted enquiries"]);
    expect(withUser.map((b) => b.query)).toEqual(["pm=u1", "seg=out&date=this-week", "status=ENQUIRY"]);
    expect(jobsBuiltInViews(undefined).map((b) => b.name)).toEqual(["Out this week", "Unquoted enquiries"]);
  });

  it("drops unknown status/type values from the URL args", () => {
    const args = jobsQueryArgs(parse("status=NOPE&type=BOGUS&date=bogus"), NOW);
    expect(args.statusIn).toBeUndefined();
    expect(args.typeIn).toBeUndefined();
    expect(args.dateFrom).toBeUndefined();
    expect(jobsQueryArgs(parse("status=QUOTED,NOPE"), NOW).statusIn).toEqual(["QUOTED"]);
  });

  it("maps the PM filter to pmIn and shows the resolved name as the PM fact", () => {
    expect(jobsQueryArgs(parse("pm=u1,u2"), NOW).pmIn).toEqual(["u1", "u2"]);
    const row = jobRowOf({ id: "a", projectNumber: "P-1", name: "J", projectManagerId: "u1" }, { pmName: "Pat PM" });
    expect(row.facts.pm).toEqual({ kind: "text", label: "Pat PM" });
  });

  it("neutralises a formula-looking job name in the export", () => {
    const csv = jobsCsv([{ id: "a", projectNumber: "P-1", name: "=1+1", total: 5, status: "QUOTED" }]);
    expect(csv.split("\n")[1].startsWith("P-1,'=1+1,")).toBe(true);
  });

  it("exports a CSV with quoting and blank money", () => {
    const csv = jobsCsv([{ id: "a", projectNumber: "P-1", name: 'Say "hi", now', total: null, status: "QUOTED" }]);
    expect(csv.split("\n")[1]).toBe('P-1,"Say ""hi"", now",,Quoted,,,,,');
  });
});
