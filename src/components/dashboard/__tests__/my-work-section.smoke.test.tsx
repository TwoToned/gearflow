// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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
});
