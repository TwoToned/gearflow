// @vitest-environment jsdom
//
// The Work section of the project context sidebar (work-layer v2 §4.3).
// Covers what the shaping module's unit tests can't: that the counts reach
// the header, the cap holds, an unowned row is visibly unowned, the done
// toggle writes, and collapsing actually hides the list.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1", name: "Ada" } } }),
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/hooks/use-document-dates-config", () => ({
  useDocumentDatesConfig: () => ({ isLoading: false, timezone: "Australia/Melbourne" }),
}));

const updateMock = vi.fn().mockResolvedValue(undefined);
const createMock = vi.fn().mockResolvedValue("id");
vi.mock("@/hooks/use-project-tasks-writes", () => ({
  useProjectTaskWrites: () => ({ update: updateMock, create: createMock }),
}));

const refetchMock = vi.fn();
let workData: {
  tasks: unknown[];
  isLoading: boolean;
  assignees?: { users: { id: string; name: string }[]; crew: [] };
} = { tasks: [], isLoading: false, assignees: { users: [], crew: [] } };
vi.mock("@/hooks/use-project-work-data", () => ({
  useProjectWorkData: () => ({ ...workData, refetch: refetchMock, orgId: "org1" }),
}));

import { ProjectWorkRailSection } from "@/components/projects/project-work-rail-section";

const row = (over: Record<string, unknown>) => ({
  description: null,
  status: "TODO",
  priority: "NORMAL",
  dueDate: null,
  checklist: null,
  assigneeUserId: null,
  assigneeCrewId: null,
  assigneeUser: null,
  assigneeCrew: null,
  ...over,
});

beforeEach(() => {
  updateMock.mockClear();
  refetchMock.mockClear();
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom always has storage; guard anyway */
  }
  workData = { tasks: [], isLoading: false, assignees: { users: [], crew: [] } };
});

describe("ProjectWorkRailSection", () => {
  it("shows a skeleton while loading, not an empty state", () => {
    workData = { tasks: [], isLoading: true };
    const { container } = render(<ProjectWorkRailSection projectId="p1" />);
    expect(container.querySelector("[aria-busy]")).toBeTruthy();
    expect(screen.queryByText(/No work on this job yet/)).toBeNull();
  });

  it("carries the counts in the header so they survive collapsing", () => {
    workData = {
      tasks: [
        row({ id: "1", title: "Late one", dueDate: "2000-01-01" }),
        row({ id: "2", title: "Owned", assigneeUserId: "u1", assigneeUser: { id: "u1", name: "Ada", image: null } }),
        row({ id: "3", title: "Done one", status: "DONE" }),
      ],
      isLoading: false,
    };
    render(<ProjectWorkRailSection projectId="p1" />);
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(screen.getByText("1 late")).toBeTruthy();
    // Only "Late one" is both open and unowned: "Owned" has an assignee and
    // "Done one" is finished.
    expect(screen.getByText("1 unowned")).toBeTruthy();
  });

  it("counts only OPEN work as unowned — a finished row needs no owner", () => {
    workData = {
      tasks: [row({ id: "1", title: "Open" }), row({ id: "2", title: "Finished", status: "DONE" })],
      isLoading: false,
    };
    render(<ProjectWorkRailSection projectId="p1" />);
    expect(screen.getByText("1 unowned")).toBeTruthy();
  });

  it("orders overdue first and caps the list, deferring the rest to the tab", () => {
    workData = {
      tasks: [
        row({ id: "a", title: "Undated" }),
        row({ id: "b", title: "Next week", dueDate: "2099-01-01" }),
        row({ id: "c", title: "Overdue", dueDate: "2000-01-01" }),
        row({ id: "d", title: "Fourth", dueDate: "2099-01-02" }),
        row({ id: "e", title: "Fifth", dueDate: "2099-01-03" }),
        row({ id: "f", title: "Sixth", dueDate: "2099-01-04" }),
      ],
      isLoading: false,
    };
    render(<ProjectWorkRailSection projectId="p1" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(within(items[0]).getByText("Overdue")).toBeTruthy();
    // Undated sorts last, so it is the row the cap drops — the link below
    // carries it. Five rows is the working set, not a page-one of six.
    expect(screen.queryByText("Undated")).toBeNull();
    expect(screen.getByRole("link", { name: /All 6 in the Work tab/ })).toBeTruthy();
  });

  it("marks an unowned row as unowned rather than leaving the slot blank", () => {
    workData = { tasks: [row({ id: "1", title: "Print run sheets" })], isLoading: false };
    render(<ProjectWorkRailSection projectId="p1" />);
    expect(screen.getByLabelText("No owner")).toBeTruthy();
  });

  it("ticking a row writes the status and refetches", () => {
    workData = { tasks: [row({ id: "1", title: "Confirm access" })], isLoading: false };
    render(<ProjectWorkRailSection projectId="p1" />);
    fireEvent.click(screen.getByLabelText("Mark Confirm access done"));
    expect(updateMock).toHaveBeenCalledWith("1", { status: "DONE" });
  });

  it("collapsing hides the rows but keeps the header counts", () => {
    workData = { tasks: [row({ id: "1", title: "Confirm access" })], isLoading: false };
    render(<ProjectWorkRailSection projectId="p1" />);
    expect(screen.getByText("Confirm access")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("Confirm access")).toBeNull();
    expect(screen.getByText("0 of 1")).toBeTruthy();
  });

  it("says the work is finished rather than showing the same empty line as a fresh job", () => {
    workData = { tasks: [row({ id: "1", title: "Done", status: "DONE" })], isLoading: false };
    render(<ProjectWorkRailSection projectId="p1" />);
    expect(screen.getByText(/All work on this job is done/)).toBeTruthy();
  });
});
