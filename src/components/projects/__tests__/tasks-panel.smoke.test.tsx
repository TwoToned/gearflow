// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const TASKS = [
  { id: "t1", title: "Order cables", description: null, status: "TODO", priority: "NORMAL", dueDate: null, assigneeUserId: null, assigneeCrewId: null, assigneeUser: null, assigneeCrew: null, sortOrder: 1 },
  { id: "t2", title: "Send call sheet", description: null, status: "DONE", priority: "NORMAL", dueDate: null, assigneeUserId: null, assigneeCrewId: null, assigneeUser: null, assigneeCrew: null, sortOrder: 2 },
];

vi.mock("@/hooks/use-project-task-list", () => ({
  useProjectTaskList: () => ({ tasks: TASKS, isLoading: false, refetch: vi.fn(), assignees: { users: [], crew: [] } }),
}));
vi.mock("@/hooks/use-project-tasks-writes", () => ({
  useProjectTaskWrites: () => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }),
}));

import { TasksPanel } from "../tasks-panel";

describe("TasksPanel", () => {
  it("shows open tasks, a closed section, and the add box", () => {
    render(<TasksPanel projectId="p1" />);
    expect(screen.getByLabelText("New task title")).toBeTruthy();
    expect(screen.getByText("Order cables")).toBeTruthy();
    expect(screen.getByText("Send call sheet")).toBeTruthy();
    expect(screen.getByText(/Closed · 1/)).toBeTruthy();
  });
});
