import { describe, expect, it } from "vitest";
import { floorBackText, sortSoonestBack, taskDueText } from "@/lib/home-rows";

const NOW = new Date(2026, 10, 9, 9, 30).getTime();
const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();
const fmt = (d: Date) => `${d.getDate()} Nov`;

describe("taskDueText", () => {
  it("overdue / today / a date / undated", () => {
    expect(taskDueText(at(7), NOW, fmt)).toEqual({ text: "2d overdue", tone: "late" });
    expect(taskDueText(at(9, 23), NOW, fmt)).toEqual({ text: "Today", tone: "today" });
    expect(taskDueText(at(9, 0), NOW, fmt)).toEqual({ text: "Today", tone: "today" });
    expect(taskDueText(at(10), NOW, fmt)).toEqual({ text: "10 Nov", tone: "plain" });
    expect(taskDueText(null, NOW, fmt)).toBeNull();
  });
});

describe("floorBackText", () => {
  it("overdue / back today / back in n days / undated", () => {
    expect(floorBackText(at(6), NOW)).toEqual({ text: "3d overdue", late: true });
    expect(floorBackText(at(9, 18), NOW)).toEqual({ text: "back today", late: false });
    expect(floorBackText(at(11), NOW)).toEqual({ text: "back in 2d", late: false });
    expect(floorBackText(undefined, NOW)).toBeNull();
  });
});

describe("sortSoonestBack", () => {
  it("orders by end date, undated last, without mutating", () => {
    const jobs = [{ id: "c" }, { id: "b", rentalEndDate: at(12) }, { id: "a", rentalEndDate: new Date(at(8)).toISOString() }];
    expect(sortSoonestBack(jobs).map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(jobs[0].id).toBe("c");
  });
});
