// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MovingStage } from "../moving-stage";
import { jobRowIds } from "@/components/warehouse/job/job-table";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import type { JobSection } from "@/lib/warehouse-job-rows";

afterEach(cleanup);

const sections: JobSection[] = [{
  key: "loose", section: { id: "loose", title: "Loose", count: 1 },
  rows: [{ id: "l1", kind: "gear", title: "Lamp", tags: [], facts: { qty: { kind: "qty", value: 1 } }, status: { label: "Prepped", intent: "info" } }],
}];

function Harness({ run }: { run: () => void }) {
  const selection = useRowSelection(jobRowIds(sections));
  return <MovingStage sections={sections} selection={selection} actions={[{ key: "go", label: "Deploy", primary: true, run }]} empty={{ title: "Nothing", description: "x" }} />;
}

describe("MovingStage", () => {
  it("shows the verbs only once a row is ticked, then runs one", () => {
    const run = vi.fn();
    render(<Harness run={run} />);
    expect(screen.queryByRole("button", { name: /Deploy/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("checkbox")[screen.getAllByRole("checkbox").length - 1]);
    fireEvent.click(screen.getByRole("button", { name: "Deploy (1)" }));
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("renders the empty state with no sections", () => {
    const selection = { count: 0 } as never;
    render(<MovingStage sections={[]} selection={selection} actions={[]} empty={{ title: "Nothing prepped", description: "d" }} />);
    expect(screen.getByText("Nothing prepped")).toBeTruthy();
  });
});
