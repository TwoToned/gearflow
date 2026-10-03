import { describe, it, expect } from "vitest";
import {
  isLateWork,
  isUnownedWork,
  sortOpenWork,
  summariseProjectWork,
  type WorkTaskLike,
} from "./project-work";

const TZ = "Australia/Melbourne";
// 2026-09-19T02:00Z = 12:00 on the 19th in Melbourne.
const NOW = Date.UTC(2026, 8, 19, 2, 0);

const task = (over: Partial<WorkTaskLike> & { id: string }): WorkTaskLike => ({
  title: over.id,
  status: "TODO",
  ...over,
});

describe("isLateWork", () => {
  it("is true only for open work past the org's start of today", () => {
    expect(isLateWork(task({ id: "a", dueDate: "2026-09-18" }), NOW, TZ)).toBe(true);
    expect(isLateWork(task({ id: "b", dueDate: "2026-09-19" }), NOW, TZ)).toBe(false);
    expect(isLateWork(task({ id: "c", dueDate: "2026-09-25" }), NOW, TZ)).toBe(false);
    expect(isLateWork(task({ id: "d" }), NOW, TZ)).toBe(false);
  });

  it("is never true for finished work, however old the due date", () => {
    expect(isLateWork(task({ id: "e", dueDate: "2020-01-01", status: "DONE" }), NOW, TZ)).toBe(false);
    expect(isLateWork(task({ id: "f", dueDate: "2020-01-01", status: "CANCELLED" }), NOW, TZ)).toBe(false);
  });
});

describe("isUnownedWork", () => {
  it("counts a crew assignee as owned, not just a user", () => {
    expect(isUnownedWork(task({ id: "a" }))).toBe(true);
    expect(isUnownedWork(task({ id: "b", assigneeUserId: "u1" }))).toBe(false);
    expect(isUnownedWork(task({ id: "c", assigneeCrewId: "c1" }))).toBe(false);
  });
});

describe("sortOpenWork", () => {
  it("puts overdue first, then due ascending, then undated — and drops finished work", () => {
    const rows = [
      task({ id: "undated" }),
      task({ id: "done", dueDate: "2026-09-01", status: "DONE" }),
      task({ id: "soon", dueDate: "2026-09-21" }),
      task({ id: "late", dueDate: "2026-09-10" }),
      task({ id: "today", dueDate: "2026-09-19" }),
    ];
    expect(sortOpenWork(rows).map((t) => t.id)).toEqual(["late", "today", "soon", "undated"]);
  });

  it("breaks ties by title so the order is stable, not read-order dependent", () => {
    const rows = [
      task({ id: "b", title: "Beta", dueDate: "2026-09-20" }),
      task({ id: "a", title: "Alpha", dueDate: "2026-09-20" }),
    ];
    expect(sortOpenWork(rows).map((t) => t.title)).toEqual(["Alpha", "Beta"]);
    expect(sortOpenWork([...rows].reverse()).map((t) => t.title)).toEqual(["Alpha", "Beta"]);
  });

  it("does not mutate its input", () => {
    const rows = [task({ id: "b", dueDate: "2026-09-21" }), task({ id: "a", dueDate: "2026-09-10" })];
    sortOpenWork(rows);
    expect(rows.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("summariseProjectWork", () => {
  const rows: WorkTaskLike[] = [
    task({ id: "1", stage: "prep", dueDate: "2026-09-10" }), // late, unowned
    task({ id: "2", stage: "prep", status: "DONE" }),
    task({ id: "3", stage: "quote", assigneeUserId: "u1" }),
    task({ id: "4", status: "CANCELLED", stage: "prep" }),
    task({ id: "5", assigneeCrewId: "c1" }), // no stage
  ];

  it("counts open, done, total, late and unowned", () => {
    const s = summariseProjectWork(rows, NOW, TZ);
    expect(s.openCount).toBe(3);
    expect(s.doneCount).toBe(1);
    expect(s.totalCount).toBe(4); // cancelled excluded
    expect(s.lateCount).toBe(1);
    expect(s.unownedCount).toBe(1);
  });

  // D2: dropping stage-less rows is what made the Overview card's own total
  // disagree with the Work tab header directly above it.
  it("gives stage-less work its own trailing segment instead of dropping it", () => {
    const s = summariseProjectWork(rows, NOW, TZ);
    expect(s.meter.map((m) => m.stage)).toEqual(["quote", "prep", "unstaged"]);
    expect(s.meter.at(-1)).toMatchObject({ stage: "unstaged", label: "No stage", total: 1, done: 0 });
    // Every counted row lands in exactly one segment — the meter's totals and
    // the header's total can't drift apart.
    expect(s.meter.reduce((n, m) => n + m.total, 0)).toBe(s.totalCount);
  });

  it("draws no segment for a stage with no work, and never divides by zero", () => {
    const s = summariseProjectWork([task({ id: "1", stage: "show" })], NOW, TZ);
    expect(s.meter).toHaveLength(1);
    expect(s.meter[0]).toMatchObject({ stage: "show", pct: 0 });
    expect(summariseProjectWork([], NOW, TZ).meter).toEqual([]);
  });

  it("reports a fully finished stage as 100%", () => {
    const s = summariseProjectWork(
      [task({ id: "1", stage: "quote", status: "DONE" }), task({ id: "2", stage: "quote", status: "DONE" })],
      NOW,
      TZ,
    );
    expect(s.meter[0]).toMatchObject({ pct: 100, done: 2, total: 2 });
  });
});
