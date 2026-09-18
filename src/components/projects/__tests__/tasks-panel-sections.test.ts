// buildTaskSections (#1244, design §8.3: "Group by stage / assignee / due").
// Pure logic pulled out of tasks-panel.tsx's render loop — unit-testable
// without mounting the component.
import { describe, test, expect } from "vitest";
import { buildTaskSections, type Task } from "../tasks-panel";

function makeTask(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    description: null,
    status: "TODO",
    priority: "NORMAL",
    dueDate: null,
    checklist: null,
    assigneeUserId: null,
    assigneeCrewId: null,
    assigneeUser: null,
    assigneeCrew: null,
    stage: null,
    ...overrides,
  };
}

describe("buildTaskSections", () => {
  test("status grouping reproduces the pre-#1244 TODO/IN_PROGRESS/DONE/CANCELLED order, empty sections dropped", () => {
    const tasks = [
      makeTask({ id: "a", title: "A", status: "DONE" }),
      makeTask({ id: "b", title: "B", status: "TODO" }),
    ];
    const sections = buildTaskSections(tasks, "status");
    expect(sections.map((s) => s.key)).toEqual(["TODO", "DONE"]);
  });

  test("stage grouping follows the fixed WORK_STAGES order and buckets stageless tasks last", () => {
    const tasks = [
      makeTask({ id: "a", title: "A", stage: "close" }),
      makeTask({ id: "b", title: "B", stage: "quote" }),
      makeTask({ id: "c", title: "C", stage: null }),
    ];
    const sections = buildTaskSections(tasks, "stage");
    expect(sections.map((s) => s.key)).toEqual(["quote", "close", "none"]);
  });

  test("assignee grouping sorts by name, unassigned last", () => {
    const tasks = [
      makeTask({ id: "a", title: "A", assigneeUser: { id: "u1", name: "Zoe", image: null } }),
      makeTask({ id: "b", title: "B", assigneeUser: { id: "u2", name: "Amir", image: null } }),
      makeTask({ id: "c", title: "C" }),
    ];
    const sections = buildTaskSections(tasks, "assignee");
    expect(sections.map((s) => s.key)).toEqual(["Amir", "Zoe", "unassigned"]);
  });

  test("assignee grouping falls back to the crew name when there's no user assignee", () => {
    const tasks = [makeTask({ id: "a", title: "A", assigneeCrew: { id: "c1", firstName: "Cara", lastName: "Crew" } })];
    const sections = buildTaskSections(tasks, "assignee");
    expect(sections.map((s) => s.key)).toEqual(["Cara Crew"]);
  });

  test("due grouping buckets overdue/today/week/later/none relative to `now`", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const tasks = [
      makeTask({ id: "overdue", title: "Overdue", dueDate: "2026-09-15T00:00:00Z" }),
      makeTask({ id: "today", title: "Today", dueDate: "2026-09-17T18:00:00Z" }),
      makeTask({ id: "week", title: "This week", dueDate: "2026-09-20T00:00:00Z" }),
      makeTask({ id: "later", title: "Later", dueDate: "2026-10-01T00:00:00Z" }),
      makeTask({ id: "none", title: "No date" }),
    ];
    const sections = buildTaskSections(tasks, "due", now);
    expect(sections.map((s) => s.key)).toEqual(["overdue", "today", "week", "later", "none"]);
    expect(sections.find((s) => s.key === "overdue")?.tasks.map((t) => t.id)).toEqual(["overdue"]);
  });
});
