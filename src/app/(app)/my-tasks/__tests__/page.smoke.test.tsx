// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const TASKS = [
  { id: "t1", title: "Book the truck", status: "TODO", priority: "HIGH", dueDate: 1_000, overdue: true, projectId: "p1", projectName: "Big Gig", projectNumber: "P-1" },
  { id: "t2", title: "Call venue", status: "TODO", priority: "NORMAL", dueDate: null, overdue: false, projectId: null, projectName: "", projectNumber: "" },
];

vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/hooks/use-native-dashboard", () => ({ useNativeMyOpenTasks: () => TASKS }));
vi.mock("@/hooks/use-project-tasks-writes", () => ({ useProjectTaskWrites: () => ({ update: vi.fn() }) }));
vi.mock("@/components/auth/require-permission", () => ({ RequirePermission: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import MyTasksPage from "../page";

describe("MyTasksPage", () => {
  it("lists my open tasks with their job, and a personal label when there is none", () => {
    render(<MyTasksPage />);
    expect(screen.getByText("Book the truck")).toBeTruthy();
    expect(screen.getByText(/P-1 · Big Gig/)).toBeTruthy();
    expect(screen.getByText("Call venue")).toBeTruthy();
    expect(screen.getByText(/Personal/)).toBeTruthy();
  });
});
