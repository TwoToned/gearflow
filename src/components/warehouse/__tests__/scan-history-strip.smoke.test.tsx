// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ScanHistoryStrip } from "@/components/warehouse/scan-history-strip";
import type { ScanHistoryRecord } from "@/hooks/use-scan-feedback";

afterEach(() => cleanup());

function makeEntry(overrides: Partial<ScanHistoryRecord>): ScanHistoryRecord {
  return {
    label: "SM58 · A-1042",
    outcome: "Prepped",
    kind: "success",
    at: Date.now(),
    ...overrides,
  };
}

describe("ScanHistoryStrip", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = render(<ScanHistoryStrip entries={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders an aria-live region with one row per entry and the right intent class per kind", () => {
    const entries: ScanHistoryRecord[] = [
      makeEntry({ label: "A", outcome: "Prepped", kind: "success" }),
      makeEntry({ label: "B", outcome: "Kit not assigned", kind: "error" }),
      makeEntry({ label: "C", outcome: "Scan the parent instead", kind: "exception" }),
      makeEntry({ label: "D", outcome: "Quantity prompt", kind: "info" }),
    ];
    render(<ScanHistoryStrip entries={entries} />);

    const liveRegion = screen.getByText("A").closest('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.getAttribute("aria-atomic")).toBe("false");

    const rows = liveRegion ? Array.from(liveRegion.children) : [];
    expect(rows).toHaveLength(4);
    expect(rows[0].querySelector(".text-ok")).not.toBeNull();
    expect(rows[1].querySelector(".text-t-out")).not.toBeNull();
    expect(rows[2].querySelector(".text-warn")).not.toBeNull();
    expect(rows[3].querySelector(".text-muted")).not.toBeNull();
  });

  it("renders Undo only on the newest entry, and calls its run() on click", () => {
    const run = vi.fn();
    const entries: ScanHistoryRecord[] = [
      makeEntry({ label: "Newest", outcome: "Deployed", undo: { label: "Undo", run } }),
      makeEntry({ label: "Older", outcome: "Prepped" }),
    ];
    render(<ScanHistoryStrip entries={entries} />);

    const undoButtons = screen.getAllByRole("button", { name: "Undo" });
    expect(undoButtons).toHaveLength(1);
    fireEvent.click(undoButtons[0]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not render Undo once the entry's window has elapsed", () => {
    const run = vi.fn();
    const entries: ScanHistoryRecord[] = [
      makeEntry({ label: "Stale", outcome: "Deployed", at: Date.now() - 20_000, undo: { label: "Undo", run } }),
    ];
    render(<ScanHistoryStrip entries={entries} />);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("shows a 'Show all' expander only beyond 2 entries", () => {
    render(<ScanHistoryStrip entries={[makeEntry({ label: "A" }), makeEntry({ label: "B" })]} />);
    expect(screen.queryByText("Show all")).toBeNull();

    cleanup();
    render(
      <ScanHistoryStrip
        entries={[makeEntry({ label: "A" }), makeEntry({ label: "B" }), makeEntry({ label: "C" })]}
      />,
    );
    expect(screen.getByText("Show all")).not.toBeNull();
  });
});
