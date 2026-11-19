// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { JobTable, jobRowIds } from "@/components/warehouse/job/job-table";
import type { JobSection } from "@/lib/warehouse-job-rows";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const sections: JobSection[] = [
  { key: "c1", section: { id: "c1", title: "LX-04", count: 2 }, rows: [
    { id: "a", kind: "gear", title: "SM58", facts: { qty: { kind: "qty", value: 2 } } },
    { id: "b", kind: "gear", title: "Beta 91", facts: { qty: { kind: "qty", value: 1 } } },
  ] },
  { key: "loose", section: { id: "loose", title: "Loose", count: 1 }, rows: [
    { id: "c", kind: "gear", title: "XLR 5m", facts: { qty: { kind: "qty", value: 8 } } },
  ] },
];

function Harness() {
  const selection = useRowSelection(jobRowIds(sections));
  return (
    <>
      <JobTable sections={sections} selection={selection}
        sectionFlags={(s) => (s.key === "c1" ? [{ label: "Active", tone: "warning" }] : [])} />
      <output data-testid="n">{selection.count}</output>
    </>
  );
}

describe("JobTable", () => {
  it("one table, section heads before their rows, flags on the head", () => {
    render(<Harness />);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByText("LX-04")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("XLR 5m")).toBeTruthy();
  });
  it("a head's tick-all selects exactly that section's rows", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all in LX-04" }));
    expect(screen.getByTestId("n").textContent).toBe("2");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all in LX-04" }));
    expect(screen.getByTestId("n").textContent).toBe("0");
  });
});
