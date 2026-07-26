// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyWorkSection } from "@/components/dashboard/my-work-section";

const base = {
  id: "p1",
  name: "Gig",
  projectNumber: "260601",
  client: { name: "ACME" },
  _count: { lineItems: 3 },
};

describe("MyWorkSection smoke", () => {
  it("renders with realistic deployed/upcoming projects (date-fns format path)", () => {
    const projects = [
      { ...base, id: "a", status: "CHECKED_OUT", rentalStartDate: "2026-06-01T00:00:00.000Z", rentalEndDate: "2026-06-10T00:00:00.000Z" },
      { ...base, id: "b", status: "CONFIRMED", rentalStartDate: "2026-09-01T00:00:00.000Z", rentalEndDate: "2026-09-05T00:00:00.000Z" },
      { ...base, id: "c", status: "PREPPING", rentalStartDate: "2026-12-01T00:00:00.000Z", rentalEndDate: null },
    ];
    const blockers = [
      { projectId: "a", threadId: "t1", snippet: "Need sign-off on the revised quote", reason: "pm", projectName: "Gig", projectNumber: "260601", createdByName: "Jay", createdAt: 1 },
    ];
    expect(() =>
      render(<MyWorkSection projects={projects} blockers={blockers} />),
    ).not.toThrow();
  });

  it("renders with null/missing dates and missing _count without throwing", () => {
    const projects = [
      { id: "x", name: "No dates", projectNumber: "X", status: "ENQUIRY", client: null, rentalStartDate: null, rentalEndDate: null },
      { id: "y", name: "No count", projectNumber: "Y", status: "CHECKED_OUT", client: { name: "C" }, rentalStartDate: null, rentalEndDate: "2026-01-01T00:00:00.000Z" },
    ];
    expect(() => render(<MyWorkSection projects={projects} blockers={[]} />)).not.toThrow();
  });

  it("renders empty + all-clear without throwing", () => {
    expect(() => render(<MyWorkSection projects={[]} />)).not.toThrow();
  });

  it("renders the tasks-due block with a 'N more' link when tasks exceed the shown count", () => {
    const projects = [{ ...base, id: "a", status: "CONFIRMED", rentalStartDate: null, rentalEndDate: null }];
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: i === 0 ? "IN_PROGRESS" : "TODO",
      priority: "NORMAL",
      dueDate: i === 0 ? Date.now() - 86_400_000 : null,
      overdue: i === 0,
      projectId: "a",
      projectName: "Gig",
      projectNumber: "260601",
    }));
    render(<MyWorkSection projects={projects} tasks={tasks} />);
    // Only the first 5 are shown as rows...
    expect(screen.getByText("Task 0")).toBeDefined();
    expect(screen.getByText("Task 4")).toBeDefined();
    expect(screen.queryByText("Task 5")).toBeNull();
    // ...and the remaining 2 surface as a "more" link to /my-tasks.
    const moreLink = screen.getByText(/2 more/);
    expect(moreLink.closest("a")?.getAttribute("href")).toBe("/my-tasks");
  });

  it("omits the tasks-due block entirely when there are no open tasks", () => {
    render(<MyWorkSection projects={[]} tasks={[]} />);
    expect(screen.queryByText("Tasks due")).toBeNull();
  });
});
