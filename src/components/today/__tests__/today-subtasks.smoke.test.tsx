// @vitest-environment jsdom
//
// TodaySubtasks (Phase 1, #1243) — renders a task's subtasks in the peek
// panel, toggles done via the existing update mutation, and adds a new
// subtask via createNative with parentId set.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const updateMock = vi.fn().mockResolvedValue(undefined);
const createMock = vi.fn().mockResolvedValue("new-subtask-id");
vi.mock("@/hooks/use-project-tasks-writes", () => ({
  useProjectTaskWrites: () => ({ update: updateMock, create: createMock }),
}));

let subtasks: unknown[] | undefined = [];
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: () => subtasks,
}));

import { TodaySubtasks } from "../today-subtasks";

describe("TodaySubtasks", () => {
  beforeEach(() => {
    updateMock.mockClear();
    createMock.mockClear();
  });

  it("shows an empty state when there are no subtasks yet", () => {
    subtasks = [];
    render(<TodaySubtasks parentId="t1" orgId="org1" canEdit={true} />);
    expect(screen.getByText("No subtasks yet.")).toBeDefined();
  });

  it("renders subtasks, TODO unchecked and DONE struck through", () => {
    subtasks = [
      { id: "s1", title: "Book the van", status: "TODO", completedAt: null },
      { id: "s2", title: "Confirm crew", status: "DONE", completedAt: 1_700_000_000_000 },
    ];
    render(<TodaySubtasks parentId="t1" orgId="org1" canEdit={true} />);
    expect(screen.getByText("Book the van")).toBeDefined();
    expect(screen.getByText("Confirm crew")).toBeDefined();
    expect(screen.getByText("Confirm crew").className).toContain("line-through");
  });

  it("clicking a TODO subtask marks it DONE", () => {
    subtasks = [{ id: "s1", title: "Book the van", status: "TODO", completedAt: null }];
    render(<TodaySubtasks parentId="t1" orgId="org1" canEdit={true} />);
    fireEvent.click(screen.getByText("Book the van"));
    expect(updateMock).toHaveBeenCalledWith("s1", { status: "DONE" });
  });

  it("submitting the add-subtask input creates a subtask with the parentId set, then clears", async () => {
    subtasks = [];
    render(<TodaySubtasks parentId="t1" orgId="org1" canEdit={true} />);
    const input = screen.getByPlaceholderText("Add a subtask");
    fireEvent.change(input, { target: { value: "New step" } });
    fireEvent.submit(input.closest("form")!);
    expect(createMock).toHaveBeenCalledWith({ title: "New step", parentId: "t1" });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("read-only when canEdit is false — no toggle, no add input", () => {
    subtasks = [{ id: "s1", title: "Book the van", status: "TODO", completedAt: null }];
    render(<TodaySubtasks parentId="t1" orgId="org1" canEdit={false} />);
    fireEvent.click(screen.getByText("Book the van"));
    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Add a subtask")).toBeNull();
  });
});
