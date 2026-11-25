// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defaultListState } from "@/lib/list-url-state";
import {
  OVERBOOKINGS_SPEC,
  daysForSegment,
  filterByKind,
  flattenBoard,
  overbookingSegments,
  pageRows,
  rowsForState,
  segFromDays,
  sortRows,
} from "./overbookings";

const DAY = 86_400_000;
const proj = (n: number) => ({ id: `p${n}`, name: `Job ${n}`, projectNumber: `PRJ-${n}` });
const BOARD = {
  range: { start: 0, end: 30 * DAY },
  gearHard: [{ modelId: "m1", modelName: "SM58", qty: 2, spanStart: 5 * DAY, spanEnd: 6 * DAY, projects: [proj(1)] }],
  gearPencilled: [{ modelId: "m2", modelName: "Hazer", qty: 1, spanStart: 2 * DAY, spanEnd: 2 * DAY, projects: [proj(2)] }],
  saleStockToProcure: [{ modelId: "m3", modelName: "Tape", shortfallQty: 4, contributingSaleLines: [{ lineItemId: "l", projectId: "p1", projectName: "Job 1", projectNumber: "PRJ-1", quantity: 4 }] }],
  servicesMissingCrew: [{ serviceId: "s1", projectId: "p1", projectName: "Job 1", projectNumber: "PRJ-1", title: "Run", date: 3 * DAY, endDate: 3 * DAY, crewCountRequired: 2, assignedCount: 1, shortfall: 1, shortDays: [] }],
  unconfirmedCrew: [{ assignmentId: "a1", crewMemberId: "c1", projectId: "p2", projectName: "Job 2", projectNumber: "PRJ-2", startDate: 9 * DAY, status: "OFFERED" }],
  crewDoubleBookings: [{ crewMemberId: "c2", severity: "soft" as const, label: "Sam", a: { assignmentId: "x", projectId: "p1", projectName: "Job 1", projectNumber: "PRJ-1", startDate: 4 * DAY, endDate: 5 * DAY }, b: { assignmentId: "y", projectId: "p2", projectName: "Job 2", projectNumber: "PRJ-2", startDate: 4 * DAY, endDate: 5 * DAY } }],
};

describe("flattenBoard", () => {
  it("every board section is a row of the one list, with the board's own figures", () => {
    const rows = flattenBoard(BOARD);
    expect(rows.map((r) => r.id)).toEqual(["gear:hard:m1", "gear:soft:m2", "sale:m3", "svc:s1", "asg:a1", "dbl:c2:0"]);
    expect(rows.find((r) => r.id === "gear:hard:m1")).toMatchObject({ group: "overbooked", severity: "hard", shortText: "2 short", href: "/projects/p1" });
    expect(rows.find((r) => r.id === "sale:m3")).toMatchObject({ group: "sale", shortText: "4 to procure", href: "/assets/models/m3" });
    expect(rows.find((r) => r.id === "svc:s1")).toMatchObject({ group: "crew", shortText: "1/2", severity: "hard" });
    expect(rows.find((r) => r.id === "dbl:c2:0")!.jobs.map((j) => j.projectNumber)).toEqual(["PRJ-1", "PRJ-2"]);
  });

  it("only a HARD gear row carries a sub-hire; pencilled, sale and crew rows never do", () => {
    const withSubHire = flattenBoard(BOARD).filter((r) => r.subHire).map((r) => r.id);
    expect(withSubHire).toEqual(["gear:hard:m1"]);
  });
});

describe("filter, sort and page", () => {
  const rows = flattenBoard(BOARD);

  it("Kind keeps the chosen groups (Crew is three sub-kinds); none chosen is all", () => {
    expect(filterByKind(rows, ["crew"]).map((r) => r.id)).toEqual(["svc:s1", "asg:a1", "dbl:c2:0"]);
    expect(filterByKind(rows, ["sale", "pencilled"]).map((r) => r.id)).toEqual(["gear:soft:m2", "sale:m3"]);
    expect(filterByKind(rows, [])).toHaveLength(6);
  });

  it("Severity puts hard before soft, When is soonest first with undated last, What is A to Z", () => {
    expect(sortRows(rows, "severity", "asc").map((r) => r.severity).join()).toBe("hard,hard,soft,soft,soft,soft");
    const when = sortRows(rows, "when", "asc").map((r) => r.id);
    expect(when[0]).toBe("gear:soft:m2");
    expect(when[when.length - 1]).toBe("sale:m3");
    expect(sortRows(rows, "what", "asc")[0].title).toBe("Hazer");
  });

  it("search matches the title, kind and the jobs' numbers and names; paging is 25 a page", () => {
    const state = { ...defaultListState(OVERBOOKINGS_SPEC), q: "PRJ-2" };
    expect(rowsForState(rows, state).map((r) => r.id).sort()).toEqual(["asg:a1", "dbl:c2:0", "gear:soft:m2"]);
    const many = Array.from({ length: 60 }, (_, i) => i);
    expect(pageRows(many, 1)).toHaveLength(25);
    expect(pageRows(many, 3)).toEqual(many.slice(50));
  });
});

describe("the window", () => {
  it("the strip words are 7, 30 and 90 days; the old ?days= link maps onto them", () => {
    expect([daysForSegment("week"), daysForSegment("month"), daysForSegment("all"), daysForSegment("junk")]).toEqual([7, 30, 90, 7]);
    expect([segFromDays("7"), segFromDays("14"), segFromDays("30"), segFromDays("60"), segFromDays("x"), segFromDays(null)]).toEqual(["week", "month", "month", "all", null, null]);
  });

  it("only the open window carries a count (one bundle per window)", () => {
    expect(overbookingSegments("month", 6).map((s) => [s.key, s.count])).toEqual([["week", undefined], ["month", 6], ["all", undefined]]);
  });
});
