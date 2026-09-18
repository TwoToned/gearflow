// @vitest-environment jsdom
//
// /today (work-layer phase 0.5, #1242) smoke coverage: renders without a live
// Convex provider (every data hook is mocked at its module boundary), org-tz
// bucketing puts a task in the right section, a mention surfaces in Triage,
// the all-clear empty state renders when nothing is open, and the done
// checkbox calls the existing task-status mutation.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));
vi.mock("@/lib/use-permissions", () => ({
  useCanDo: () => true,
}));
vi.mock("@/hooks/use-document-dates-config", () => ({
  useDocumentDatesConfig: () => ({ isLoading: false, quoteValidityDays: 30, paymentTermsDays: 14, timezone: "UTC" }),
}));
vi.mock("@/hooks/use-focus-polled-query", () => ({
  useFocusPolledQuery: () => ({ data: undefined, asOf: undefined, error: null, isLoading: true, refresh: vi.fn() }),
}));

const updateMock = vi.fn().mockResolvedValue(undefined);
const createMock = vi.fn().mockResolvedValue("new-task-id");
vi.mock("@/hooks/use-project-tasks-writes", () => ({
  useProjectTaskWrites: () => ({ update: updateMock, create: createMock }),
}));

const snoozeMock = vi.fn().mockResolvedValue(undefined);
const dismissMock = vi.fn().mockResolvedValue(undefined);
const promoteMock = vi.fn().mockResolvedValue("new-task-id");
vi.mock("@/hooks/use-work-signal-writes", () => ({
  useWorkSignalWrites: () => ({ snooze: snoozeMock, dismiss: dismissMock, promote: promoteMock }),
}));

const markReadMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    notifications: undefined,
    unreadCount: undefined,
    markRead: markReadMock,
    markAllRead: vi.fn(),
    archive: vi.fn(),
  }),
}));

// The component reads the real wall clock (`new Date()`), so fixtures anchor
// to it at test-run time rather than a fixed historical date.
const NOW = Date.now();

let tasks: unknown[] = [];
vi.mock("@/hooks/use-native-dashboard", () => ({
  useNativeMyOpenTasks: () => tasks,
}));

let notifications: unknown[] | undefined = [];
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: () => notifications,
}));

import TodayPage from "../page";

describe("TodayPage (smoke)", () => {
  beforeEach(() => {
    createMock.mockClear();
    promoteMock.mockClear();
  });


  it("renders the all-clear empty state when nothing is open", () => {
    tasks = [];
    notifications = [];
    render(<TodayPage />);
    expect(screen.getByText(/All clear/)).toBeDefined();
  });

  // #1267 regression: the day/needs-you rails are now shared widget
  // components (also hosted "bare" inside a `<DashboardCard>` on the
  // dashboard board) — /today must still get their own card + heading, not
  // the bare dashboard-board rendering.
  it("renders the day rail and needs-you rail with their own headings (non-bare)", () => {
    tasks = [];
    notifications = [];
    render(<TodayPage />);
    expect(screen.getByText("Your day")).toBeDefined();
    expect(screen.getByText("Needs you")).toBeDefined();
  });

  it("buckets a task due today (org tz) into the Today section, not Overdue or Later", () => {
    tasks = [
      {
        id: "t1", title: "Confirm venue access", status: "TODO", priority: "NORMAL",
        dueDate: NOW, overdue: false, projectId: "p1", projectName: "Gala Dinner", projectNumber: "260701",
        assigneeUserId: "u1", assigneeCrewId: null,
      },
    ];
    notifications = [];
    render(<TodayPage />);
    expect(screen.getByText("Confirm venue access")).toBeDefined();
    expect(screen.queryByText(/^Overdue/)).toBeNull();
  });

  it("buckets an overdue task into the Overdue section", () => {
    tasks = [
      {
        id: "t2", title: "Chase deposit", status: "TODO", priority: "HIGH",
        dueDate: NOW - 3 * 24 * 60 * 60 * 1000, overdue: true, projectId: "p1", projectName: "Gala Dinner", projectNumber: "260701",
        assigneeUserId: "u1", assigneeCrewId: null,
      },
    ];
    notifications = [];
    render(<TodayPage />);
    expect(screen.getByText(/^Overdue/)).toBeDefined();
    expect(screen.getByText("Chase deposit")).toBeDefined();
  });

  it("surfaces a mention in Triage", () => {
    tasks = [];
    notifications = [
      {
        id: "n1", organizationId: "org1", userId: "u1", type: "mentioned",
        entityType: "project", entityId: "p1", title: "Tom mentioned you", body: "check the LX notes",
        href: "/projects/p1", dedupeKey: "mention:c1:u1", readAt: undefined, archivedAt: undefined, createdAt: NOW,
      },
    ];
    render(<TodayPage />);
    expect(screen.getByText(/^Triage/)).toBeDefined();
    expect(screen.getByText("Tom mentioned you")).toBeDefined();
  });

  it("marks a mention read when its row is opened", () => {
    tasks = [];
    notifications = [
      {
        id: "n2", organizationId: "org1", userId: "u1", type: "mentioned",
        entityType: "project", entityId: "p1", title: "Reply needed", body: "on the quote",
        href: "/projects/p1", dedupeKey: "mention:c2:u1", readAt: undefined, archivedAt: undefined, createdAt: NOW,
      },
    ];
    render(<TodayPage />);
    fireEvent.click(screen.getByText("Reply needed"));
    expect(markReadMock).toHaveBeenCalledWith("n2");
  });

  it("clicking the done circle calls the task-status mutation", () => {
    tasks = [
      {
        id: "t3", title: "Book LX crew", status: "TODO", priority: "NORMAL",
        dueDate: NOW, overdue: false, projectId: "p1", projectName: "Gala Dinner", projectNumber: "260701",
        assigneeUserId: "u1", assigneeCrewId: null,
      },
    ];
    notifications = [];
    render(<TodayPage />);
    fireEvent.click(screen.getByTitle("Mark done"));
    expect(updateMock).toHaveBeenCalledWith("t3", { status: "DONE" });
  });

  it("un-done: clicking the checked circle again reverts the task to TODO", () => {
    tasks = [
      {
        id: "t4", title: "Pack the LX truck", status: "TODO", priority: "NORMAL",
        dueDate: NOW, overdue: false, projectId: "p1", projectName: "Gala Dinner", projectNumber: "260701",
        assigneeUserId: "u1", assigneeCrewId: null,
      },
    ];
    notifications = [];
    render(<TodayPage />);
    fireEvent.click(screen.getByTitle("Mark done"));
    expect(updateMock).toHaveBeenLastCalledWith("t4", { status: "DONE" });
    // The row stays visible (struck through) so a mis-click can be corrected —
    // /my-tasks' own status cycle has no way back once marked DONE.
    fireEvent.click(screen.getByTitle("Mark not done"));
    expect(updateMock).toHaveBeenLastCalledWith("t4", { status: "TODO" });
  });

  it("an empty Today bucket doesn't render its section while Overdue still does", () => {
    tasks = [
      {
        id: "t5", title: "Chase deposit", status: "TODO", priority: "HIGH",
        dueDate: NOW - 3 * 24 * 60 * 60 * 1000, overdue: true, projectId: "p1", projectName: "Gala Dinner", projectNumber: "260701",
        assigneeUserId: "u1", assigneeCrewId: null,
      },
    ];
    notifications = [];
    render(<TodayPage />);
    expect(screen.getByText(/^Overdue/)).toBeDefined();
    expect(screen.queryByText(/^Today/)).toBeNull();
  });

  it("an empty Triage doesn't render its section while Today still does", () => {
    tasks = [
      {
        id: "t6", title: "Confirm venue access", status: "TODO", priority: "NORMAL",
        dueDate: NOW, overdue: false, projectId: "p1", projectName: "Gala Dinner", projectNumber: "260701",
        assigneeUserId: "u1", assigneeCrewId: null,
      },
    ];
    notifications = [];
    render(<TodayPage />);
    expect(screen.getByText("Confirm venue access")).toBeDefined();
    expect(screen.queryByText(/^Triage/)).toBeNull();
  });

  // Phase 1 (#1243) additions
  it("quick-add: submitting the input creates a personal task and clears itself", async () => {
    tasks = [];
    notifications = [];
    render(<TodayPage />);
    const input = screen.getByPlaceholderText(/Quick-add a task/);
    fireEvent.change(input, { target: { value: "Call the venue" } });
    fireEvent.submit(input.closest("form")!);
    expect(createMock).toHaveBeenCalledWith({ title: "Call the venue" });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("quick-add: a blank submission does not create a task", () => {
    tasks = [];
    notifications = [];
    render(<TodayPage />);
    const input = screen.getByPlaceholderText(/Quick-add a task/);
    fireEvent.submit(input.closest("form")!);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("peek: 'Make a task' on a mention promotes the signal using its dedupeKey", () => {
    tasks = [];
    notifications = [
      {
        id: "n3", organizationId: "org1", userId: "u1", type: "mentioned",
        entityType: "project", entityId: "p1", title: "Tom mentioned you", body: "check the LX notes",
        href: "/projects/p1", dedupeKey: "mention:c3:u1", readAt: undefined, archivedAt: undefined, createdAt: NOW,
      },
    ];
    render(<TodayPage />);
    fireEvent.click(screen.getByText("Tom mentioned you"));
    fireEvent.click(screen.getByText("Make a task"));
    expect(promoteMock).toHaveBeenCalledWith({ sourceKey: "mention:c3:u1", title: "Tom mentioned you" });
  });
});
