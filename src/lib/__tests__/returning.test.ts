import { describe, it, expect } from "vitest";
import {
  filterReturning, groupHeadText, lineLate, lineOutcomeWords, lineProgressText, outcomeTotals, overdueDays, returnableLines,
} from "@/lib/returning";
import { DAY, NOW, TODAY } from "./floor-fixtures";
import { returningGroup, returningLine } from "./returning-fixtures";

describe("late (D29)", () => {
  it("gear still out is late only once the end day has passed; late-back comes from the server", () => {
    const line = returningLine({ out: 2, lateBack: 1 });
    expect(lineLate(line, { windowEnd: TODAY + DAY }, NOW)).toBe(1);
    expect(lineLate(line, { windowEnd: TODAY - 2 * DAY }, NOW)).toBe(3);
    expect(lineLate(line, { windowEnd: null }, NOW)).toBe(1);
  });
  it("overdue days count only while something is out", () => {
    const late = returningGroup({ windowEnd: TODAY - 3 * DAY });
    expect(overdueDays(late, NOW)).toBeGreaterThanOrEqual(2);
    const home = returningGroup({ windowEnd: TODAY - 3 * DAY }, [returningLine({ out: 0, back: 4 })]);
    expect(overdueDays(home, NOW)).toBe(0);
  });
});

describe("outcome strip and filters", () => {
  const a = returningLine({ lineItemId: "a", out: 2, back: 2, damaged: 1 });
  const b = returningLine({ lineItemId: "b", out: 0, back: 3, missing: 1 });
  const g1 = returningGroup({ projectId: "p1" }, [a, b]);
  const g2 = returningGroup({ projectId: "p2", windowEnd: TODAY - 2 * DAY }, [returningLine({ lineItemId: "c", out: 1, back: 0 })]);

  it("totals every outcome over every line", () => {
    expect(outcomeTotals([g1, g2], NOW)).toEqual({ out: 3, returned: 5, damaged: 1, missing: 1, late: 1 });
  });
  it("an outcome keeps only matching lines; a job keeps one group; empty groups drop", () => {
    expect(filterReturning([g1, g2], { outcome: "missing", job: null, now: NOW }).flatMap((g) => g.lines.map((l) => l.lineItemId))).toEqual(["b"]);
    expect(filterReturning([g1, g2], { outcome: "late", job: null, now: NOW }).map((g) => g.projectId)).toEqual(["p2"]);
    expect(filterReturning([g1, g2], { outcome: null, job: "p2", now: NOW }).map((g) => g.projectId)).toEqual(["p2"]);
  });
  it("only scannable lines with something out are returnable", () => {
    expect(returnableLines([a, b, returningLine({ lineItemId: "s", scannable: false, out: 1 })]).map((l) => l.lineItemId)).toEqual(["a"]);
  });
});

describe("row text", () => {
  it("progress, outcome words and the group head", () => {
    const line = returningLine({ out: 1, back: 3, damaged: 1 });
    const g = returningGroup({ windowEnd: TODAY - 2 * DAY }, [line]);
    expect(lineProgressText(line)).toBe("1 out · 3 of 4 back");
    expect(lineOutcomeWords(line, g, NOW)).toEqual(["1 damaged", "1 late"]);
    expect(groupHeadText(g, NOW)).toMatch(/^#2341 Gala · due back .+ · 1 out · \d+d overdue$/);
  });
});
