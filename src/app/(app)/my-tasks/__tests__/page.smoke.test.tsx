// @vitest-environment jsdom
//
// /my-tasks (#952 / QW-3): renders grouped rows off useNativeMyOpenTasks, shows
// the FlowMascot all-clear empty state when there's nothing open, and gates the
// inline status-cycle button behind useCanDo("project", "update") — a read-only
// role (viewer/warehouse) gets a static icon instead of a clickable one.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));

let canDo = true;
vi.mock("@/lib/use-permissions", () => ({
  useCanDo: () => canDo,
}));

let mockTasks: unknown[] | undefined = [];
vi.mock("@/hooks/use-native-dashboard", () => ({
  useNativeMyOpenTasks: () => mockTasks,
}));

const updateSpy = vi.fn(async () => undefined);
vi.mock("@/hooks/use-project-tasks-writes", () => ({
  useProjectTaskWrites: () => ({ update: updateSpy }),
}));

import MyTasksPage from "../page";

const NOW = Date.now();
const DAY = 86_400_000;

function task(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1",
    title: "Confirm crew call times",
    status: "TODO",
    priority: "NORMAL",
    dueDate: null,
    overdue: false,
    projectId: "p1",
    projectName: "Big Gig",
    projectNumber: "260701",
    assigneeUserId: "user1",
    assigneeCrewId: null,
    ...overrides,
  };
}

describe("MyTasksPage (smoke)", () => {
  beforeEach(() => {
    canDo = true;
    mockTasks = [];
    updateSpy.mockClear();
  });

  it("renders the FlowMascot all-clear empty state when there are no open tasks", () => {
    mockTasks = [];
    render(<MyTasksPage />);
    expect(screen.getAllByText(/All clear/i).length).toBeGreaterThan(0);
  });

  it("groups tasks into Overdue / Today / This week / Later buckets", () => {
    mockTasks = [
      task({ id: "overdue1", title: "Overdue task", dueDate: NOW - DAY, overdue: true }),
      task({ id: "today1", title: "Today task", dueDate: NOW }),
      task({ id: "week1", title: "This week task", dueDate: NOW + 3 * DAY }),
      task({ id: "later1", title: "Undated task", dueDate: null }),
    ];
    render(<MyTasksPage />);
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
    expect(screen.getAllByText("This week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Later").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Overdue task").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Today task").length).toBeGreaterThan(0);
    expect(screen.getAllByText("This week task").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Undated task").length).toBeGreaterThan(0);
  });

  it("clicking the status icon cycles the task forward when the user can edit", () => {
    mockTasks = [task({ id: "t1", status: "TODO" })];
    render(<MyTasksPage />);
    const button = screen.getByTitle("Move to next status");
    fireEvent.click(button);
    expect(updateSpy).toHaveBeenCalledWith("t1", { status: "IN_PROGRESS" });
  });

  it("renders a read-only (non-interactive) status icon for a permission-gated role", () => {
    canDo = false;
    mockTasks = [task({ id: "t1", status: "TODO" })];
    render(<MyTasksPage />);
    expect(screen.queryByTitle("Move to next status")).toBeNull();
    fireEvent.click(screen.getByText("Confirm crew call times"));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("links each row through to its project", () => {
    mockTasks = [task({ id: "t1", projectId: "p42", projectNumber: "260742", projectName: "Warehouse fit-out" })];
    render(<MyTasksPage />);
    const link = screen.getByText("Warehouse fit-out").closest("a");
    expect(link?.getAttribute("href")).toBe("/projects/p42");
  });
});
