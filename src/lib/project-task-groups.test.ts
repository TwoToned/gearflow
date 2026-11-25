// @vitest-environment node
import { describe, expect, test } from "vitest";
import { doneGroupLabel, dueShortcutDate, groupTasks, reorderWithinGroup } from "@/lib/project-task-groups";
import type { ProjectTaskRow } from "@/lib/project-tasks";

const NOW = Date.UTC(2026, 10, 24, 9);
const iso = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();
const task = (id: string, over: Partial<ProjectTaskRow> = {}): ProjectTaskRow => ({
  id, title: id, description: null, status: "TODO", priority: "NORMAL", dueDate: null,
  assigneeUserId: null, assigneeCrewId: null, assigneeUser: null, assigneeCrew: null, sortOrder: 0, ...over,
});
const opts = { filter: "all" as const, search: "", userId: "me", now: NOW, timezone: undefined };

describe("groupTasks", () => {
  const tasks = [
    task("late", { dueDate: iso(20) }),
    task("today", { dueDate: iso(24) }),
    task("tomorrow", { dueDate: iso(25) }),
    task("week", { dueDate: iso(28) }),
    task("later", { dueDate: new Date(Date.UTC(2026, 11, 5)).toISOString() }),
    task("undated"),
    task("done", { status: "DONE", dueDate: iso(1) }),
    task("nope", { status: "CANCELLED" }),
  ];
  test("groups by when, in order, with Done last (a done task is never Overdue)", () => {
    const g = groupTasks(tasks, opts);
    expect(g.map((x) => [x.key, x.tasks.map((t) => t.id)])).toEqual([
      ["OVERDUE", ["late"]],
      ["TODAY", ["today"]],
      ["TOMORROW", ["tomorrow"]],
      ["THIS_WEEK", ["week"]],
      ["LATER", ["later"]],
      ["NO_DATE", ["undated"]],
      ["DONE", ["done", "nope"]],
    ]);
  });

  test("filters: open, mine (open + assigned to me), done; search matches title and assignee", () => {
    const mine = [task("a", { assigneeUserId: "me" }), task("b", { assigneeUserId: "you" }), task("c", { assigneeUserId: "me", status: "DONE" })];
    expect(groupTasks(mine, { ...opts, filter: "mine" }).flatMap((x) => x.tasks.map((t) => t.id))).toEqual(["a"]);
    expect(groupTasks(mine, { ...opts, filter: "done" }).flatMap((x) => x.tasks.map((t) => t.id))).toEqual(["c"]);
    expect(groupTasks(mine, { ...opts, filter: "open" }).flatMap((x) => x.tasks.map((t) => t.id))).toEqual(["a", "b"]);
    const named = [task("x", { assigneeUser: { id: "u", name: "Priya", image: null } }), task("y")];
    expect(groupTasks(named, { ...opts, search: "priya" }).flatMap((g) => g.tasks.map((t) => t.id))).toEqual(["x"]);
  });

  test("the Done label counts cancelled separately", () => {
    expect(doneGroupLabel([task("a", { status: "DONE" }), task("b", { status: "CANCELLED" })])).toBe("Done · 1 · 1 cancelled");
    expect(doneGroupLabel([task("a", { status: "DONE" })])).toBe("Done · 1");
  });
});

describe("dueShortcutDate", () => {
  test("is relative to today in the ORG timezone, so a task set to Today is not instantly overdue", () => {
    const lateUtc = Date.UTC(2026, 10, 24, 15); // already 25 Nov in Sydney
    expect(dueShortcutDate("today", lateUtc, "UTC")).toBe("2026-11-24");
    expect(dueShortcutDate("today", lateUtc, "Australia/Sydney")).toBe("2026-11-25");
    expect(dueShortcutDate("tomorrow", lateUtc, "UTC")).toBe("2026-11-25");
    expect(dueShortcutDate("nextWeek", lateUtc, "UTC")).toBe("2026-12-01");
    expect(dueShortcutDate("clear", lateUtc, "UTC")).toBeNull();
  });
});

describe("reorderWithinGroup", () => {
  const all = ["a", "x", "b", "y", "c"];
  test("permutes the group among its own slots; other tasks keep their place", () => {
    expect(reorderWithinGroup(all, ["a", "b", "c"], "c", "a")).toEqual(["c", "x", "a", "y", "b"]);
    expect(reorderWithinGroup(all, ["a", "b", "c"], "a", "b")).toEqual(["b", "x", "a", "y", "c"]);
  });
  test("a drop outside the group or on itself is no move", () => {
    expect(reorderWithinGroup(all, ["a", "b", "c"], "a", "x")).toBeNull();
    expect(reorderWithinGroup(all, ["a", "b", "c"], "a", "a")).toBeNull();
  });
});
