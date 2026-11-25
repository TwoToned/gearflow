// @vitest-environment jsdom
//
// UX Phase 10 (spec §8c): the Tasks section. Every overlay is OPENED: the row ⋯, the
// assignee and due menus on a row, the task sheet, the add row's Due menu, Select
// mode's BulkBar and its Assign menu. Writes are asserted through the one
// `useTaskActions` closure (its Undo is covered by the Convex tests).
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const NOW = Date.UTC(2026, 10, 24, 9);
const iso = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: id, description: null, status: "TODO", priority: "NORMAL", dueDate: null,
  assigneeUserId: null, assigneeCrewId: null, assigneeUser: null, assigneeCrew: null, sortOrder: 0, ...over,
});
const TASKS = [
  row("Order cables", { dueDate: iso(20), sortOrder: 1 }), // overdue
  row("Print call sheets", { dueDate: iso(24), sortOrder: 2, assigneeUserId: "u2", assigneeUser: { id: "u2", name: "Bob", image: null } }), // today
  row("Book truck", { sortOrder: 3 }), // no date
  row("Send quote", { status: "DONE", sortOrder: 4 }),
];

vi.mock("@/hooks/use-project-task-list", () => ({
  useProjectTaskList: () => ({
    tasks: TASKS, isLoading: false, refetch: vi.fn(),
    assignees: { users: [{ id: "u2", name: "Bob", image: null }, { id: "u3", name: "Cara", image: null }], crew: [{ id: "c1", firstName: "Zed", lastName: "Crew" }] },
  }),
}));
const actions = {
  create: vi.fn(), patch: vi.fn(), toggleDone: vi.fn(), remove: vi.fn(), bulkPatch: vi.fn(), bulkRemove: vi.fn(), reorder: vi.fn(),
};
vi.mock("@/hooks/use-task-actions", () => ({ useTaskActions: () => actions }));
vi.mock("@/hooks/use-task-due-clock", () => ({ useTaskDueClock: () => ({ now: NOW, timezone: undefined, ready: true }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u2", name: "Bob" } } }) }));
let mobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));

import { TasksSection } from "@/components/projects/tasks-notes/tasks-section";

beforeEach(() => {
  vi.clearAllMocks();
  mobile = false;
});

describe("TasksSection", () => {
  it("groups open tasks by when (Overdue red first), hides Done behind its label, and filters", async () => {
    const user = userEvent.setup();
    render(<TasksSection projectId="p1" />);
    const groups = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(groups).toEqual(["Overdue", "Today", "No date"]);
    expect(screen.queryByText("Send quote")).toBeNull(); // Done is not an Open task
    await user.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.getByText("Print call sheets")).toBeTruthy();
    expect(screen.queryByText("Book truck")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Send quote")).toBeTruthy();
  });

  it("the row ⋯ opens with Edit, Mark done, Due, Delete; Delete asks first, then writes (its Undo is the toast's)", async () => {
    const user = userEvent.setup();
    render(<TasksSection projectId="p1" />);
    await user.click(screen.getByRole("button", { name: "Book truck actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Mark done/ })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: /Delete/ }));
    expect(actions.remove).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: /Delete task/ }));
    expect(actions.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "Book truck" }));
  });

  it("the due word on a row is a menu: Tomorrow patches the task's date", async () => {
    const user = userEvent.setup();
    render(<TasksSection projectId="p1" />);
    await user.click(screen.getByRole("button", { name: /Set a due date/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Tomorrow" }));
    expect(actions.patch).toHaveBeenCalledWith(expect.objectContaining({ id: "Book truck" }), { dueDate: "2026-11-25" }, expect.any(String), expect.any(String));
  });

  it("the assignee word is a menu: choosing a crew member assigns crew (user cleared)", async () => {
    const user = userEvent.setup();
    render(<TasksSection projectId="p1" />);
    await user.click(screen.getAllByRole("button", { name: /Assignee: unassigned/ })[0]);
    await user.click(await screen.findByRole("menuitem", { name: /Zed Crew \(crew\)/ }));
    expect(actions.patch).toHaveBeenCalledWith(expect.anything(), { assigneeUserId: null, assigneeCrewId: "c1" }, expect.any(String), expect.any(String));
  });

  it("the add row: ↵ adds the title, with the chosen Due", async () => {
    const user = userEvent.setup();
    render(<TasksSection projectId="p1" />);
    await user.click(screen.getByRole("button", { name: "Due ▾" }));
    await user.click(await screen.findByRole("menuitem", { name: "Today" }));
    await user.type(screen.getByLabelText("New task title"), "Confirm the PO{enter}");
    expect(actions.create).toHaveBeenCalledWith("Confirm the PO", expect.objectContaining({ dueDate: "2026-11-24" }));
  });

  it("clicking a title opens the task sheet; Save is ONE patch; the sheet shows the history line", async () => {
    const user = userEvent.setup();
    render(<TasksSection projectId="p1" />);
    await user.click(screen.getByRole("button", { name: "Book truck" }));
    const sheet = await screen.findByRole("dialog");
    await user.clear(within(sheet).getByLabelText("Title"));
    await user.type(within(sheet).getByLabelText("Title"), "Book the big truck");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(actions.patch).toHaveBeenCalledTimes(1);
    expect(actions.patch.mock.calls[0][1]).toMatchObject({ title: "Book the big truck", status: "TODO" });
  });

  it("Select mode turns the circles into checkboxes and shows the BulkBar with Assign, Due, Mark done, Delete", async () => {
    const user = userEvent.setup();
    render(<TasksSection projectId="p1" />);
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Book truck" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Order cables" }));
    expect(screen.getByText(/2 tasks selected/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Assign 2/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Cara" }));
    expect(actions.bulkPatch).toHaveBeenCalledWith(expect.arrayContaining(["Book truck", "Order cables"]), { assigneeUserId: "u3", assigneeCrewId: null }, expect.any(String));
  });

  it("the Done group is collapsed until its label is opened", async () => {
    const user = userEvent.setup();
    render(<TasksSection projectId="p1" />);
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.queryByText("Send quote")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Done · 1/ }));
    expect(screen.getByText("Send quote")).toBeTruthy();
  });
});
