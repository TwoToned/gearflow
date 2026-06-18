/**
 * Unit tests for the project-tasks Convex read layer (Phase A read-rewiring).
 *
 * Covers the mapper (epoch-ms→Date, absent→null, Prisma-default coercion) and the
 * pure filter/sort predicates that replicate the Prisma where/orderBy for
 * getProjectTasks (sortOrder asc, createdAt asc) and getMyOpenTasks (dueDate asc
 * NULLS LAST, priority desc by DECLARED order, createdAt asc) plus the
 * getTaskAssignees crew half (status != ARCHIVED, firstName asc, lastName asc).
 */
import { describe, it, expect } from "vitest";
import {
  mapProjectTask,
  sortProjectTasks,
  filterTasksForProject,
  filterMyOpenTasks,
  sortMyOpenTasks,
  selectCrewAssignees,
  type ConvexProjectTask,
} from "@/lib/project-tasks-read";
import type { Doc } from "../../convex/_generated/dataModel";

function makeDoc(overrides: Partial<ConvexProjectTask>): ConvexProjectTask {
  return {
    _id: "cx",
    _creationTime: 0,
    id: "t1",
    organizationId: "org-1",
    projectId: "p1",
    title: "Task",
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  } as ConvexProjectTask;
}

function makeCrew(overrides: Partial<Doc<"crewMembers">>): Doc<"crewMembers"> {
  return {
    _id: "cx",
    _creationTime: 0,
    id: "c1",
    organizationId: "org-1",
    firstName: "A",
    lastName: "Z",
    ...overrides,
  } as Doc<"crewMembers">;
}

describe("mapProjectTask", () => {
  it("converts epoch-ms date fields to Date and strips convex internals", () => {
    const m = mapProjectTask(
      makeDoc({ dueDate: 50000, completedAt: 60000, createdAt: 1000, updatedAt: 2000 }),
    );
    expect(m.dueDate).toEqual(new Date(50000));
    expect(m.completedAt).toEqual(new Date(60000));
    expect(m.createdAt).toEqual(new Date(1000));
    expect(m.updatedAt).toEqual(new Date(2000));
    expect(m).not.toHaveProperty("_id");
    expect(m).not.toHaveProperty("_creationTime");
  });

  it("maps absent optional fields to null", () => {
    const m = mapProjectTask(makeDoc({}));
    expect(m.description).toBeNull();
    expect(m.dueDate).toBeNull();
    expect(m.completedAt).toBeNull();
    expect(m.assigneeUserId).toBeNull();
    expect(m.assigneeCrewId).toBeNull();
    expect(m.createdById).toBeNull();
    expect(m.checklist).toBeNull();
  });

  it("coerces Prisma-defaulted columns non-null", () => {
    const m = mapProjectTask(makeDoc({}));
    expect(m.status).toBe("TODO");
    expect(m.priority).toBe("NORMAL");
    expect(m.sortOrder).toBe(0);
  });

  it("passes status/priority/sortOrder/checklist through when present", () => {
    const m = mapProjectTask(
      makeDoc({
        status: "DONE",
        priority: "HIGH",
        sortOrder: 7,
        checklist: [{ id: "x", text: "step", done: true }],
      }),
    );
    expect(m.status).toBe("DONE");
    expect(m.priority).toBe("HIGH");
    expect(m.sortOrder).toBe(7);
    expect(m.checklist).toEqual([{ id: "x", text: "step", done: true }]);
  });
});

describe("getProjectTasks filter + sort", () => {
  it("filters by project + org", () => {
    const rows = [
      mapProjectTask(makeDoc({ id: "a", projectId: "p1" })),
      mapProjectTask(makeDoc({ id: "b", projectId: "p2" })),
      mapProjectTask(makeDoc({ id: "c", projectId: "p1", organizationId: "org-2" })),
    ];
    const out = filterTasksForProject(rows, "p1", "org-1");
    expect(out.map((t) => t.id)).toEqual(["a"]);
  });

  it("orders by sortOrder asc then createdAt asc", () => {
    const rows = [
      mapProjectTask(makeDoc({ id: "a", sortOrder: 2, createdAt: 100 })),
      mapProjectTask(makeDoc({ id: "b", sortOrder: 1, createdAt: 500 })),
      mapProjectTask(makeDoc({ id: "c", sortOrder: 1, createdAt: 100 })),
    ];
    expect(sortProjectTasks(rows).map((t) => t.id)).toEqual(["c", "b", "a"]);
  });
});

describe("getMyOpenTasks filter", () => {
  const nonTemplate = new Set(["p1", "p2"]);
  const base = [
    mapProjectTask(makeDoc({ id: "mine-open", assigneeUserId: "u1", status: "TODO", projectId: "p1" })),
    mapProjectTask(makeDoc({ id: "mine-done", assigneeUserId: "u1", status: "DONE", projectId: "p1" })),
    mapProjectTask(makeDoc({ id: "other", assigneeUserId: "u2", status: "TODO", projectId: "p1" })),
    mapProjectTask(makeDoc({ id: "template", assigneeUserId: "u1", status: "TODO", projectId: "p-template" })),
    mapProjectTask(makeDoc({ id: "wrong-org", assigneeUserId: "u1", status: "TODO", projectId: "p2", organizationId: "org-2" })),
  ];

  it("keeps only my non-done tasks in non-template projects of my org", () => {
    const out = filterMyOpenTasks(base, "org-1", "u1", nonTemplate);
    expect(out.map((t) => t.id)).toEqual(["mine-open"]);
  });
});

describe("getMyOpenTasks sort", () => {
  it("orders dueDate asc NULLS LAST, then priority desc, then createdAt asc", () => {
    const rows = [
      mapProjectTask(makeDoc({ id: "nodue-high", priority: "HIGH", createdAt: 100 })),
      mapProjectTask(makeDoc({ id: "nodue-low", priority: "LOW", createdAt: 50 })),
      mapProjectTask(makeDoc({ id: "due-late", dueDate: 9000, priority: "NORMAL", createdAt: 100 })),
      mapProjectTask(makeDoc({ id: "due-early", dueDate: 1000, priority: "LOW", createdAt: 100 })),
    ];
    // dated first (early before late), then undated by priority desc.
    expect(sortMyOpenTasks(rows).map((t) => t.id)).toEqual([
      "due-early",
      "due-late",
      "nodue-high",
      "nodue-low",
    ]);
  });

  it("breaks priority ties by createdAt asc", () => {
    const rows = [
      mapProjectTask(makeDoc({ id: "newer", priority: "HIGH", createdAt: 500 })),
      mapProjectTask(makeDoc({ id: "older", priority: "HIGH", createdAt: 100 })),
    ];
    expect(sortMyOpenTasks(rows).map((t) => t.id)).toEqual(["older", "newer"]);
  });
});

describe("getTaskAssignees crew half", () => {
  it("excludes ARCHIVED crew and orders by firstName asc then lastName asc", () => {
    const crew = [
      makeCrew({ id: "c1", firstName: "Bob", lastName: "Y" }),
      makeCrew({ id: "c2", firstName: "Amy", lastName: "Z" }),
      makeCrew({ id: "c3", firstName: "Amy", lastName: "A" }),
      makeCrew({ id: "c4", firstName: "Zed", lastName: "Q", status: "ARCHIVED" }),
    ];
    const out = selectCrewAssignees(crew);
    expect(out.map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
    expect(out[0]).toEqual({ id: "c3", firstName: "Amy", lastName: "A" });
  });
});
