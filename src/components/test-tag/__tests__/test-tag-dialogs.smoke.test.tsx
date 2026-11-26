// @vitest-environment jsdom
//
// The Test & tag dialogs (UX Phase 14, 14a-3b): Reports (pick a report, its filters, PDF opens the route), Print tags
// (a label per tested item through the one template in sheet mode, never-tested items named) and Schedule (one
// scheduled TEST_AND_TAG job for the linked assets, skipped items named, the toast's Undo is the exact reverse).
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn() }), useConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: undefined }) }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const writes = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "job1" })),
  undoCreate: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/hooks/use-maintenance-writes", () => ({ useMaintenanceWrites: () => writes }));
const announced = vi.hoisted(() => ({ last: undefined as undefined | { title: string; undo?: () => void } }));
vi.mock("@/lib/list-write-toast", async () => {
  const actual = await vi.importActual<typeof import("@/lib/list-write-toast")>("@/lib/list-write-toast");
  return {
    ...actual,
    announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
      announced.last = { title: o.title, undo: o.performUndo ? () => void o.performUndo!() : undefined };
    },
  };
});
const LABELS = {
  labels: [{ id: "t1", testTagId: "TT-0001", result: "PASS", testDate: Date.UTC(2026, 0, 5), nextDueDate: Date.UTC(2026, 6, 5), testerName: "Ada" }],
  skipped: [{ id: "t2", testTagId: "TT-0002" }],
};
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return { useAuthedQuery: (q: FunctionReference<"query">, args: unknown) => (args !== "skip" && getFunctionName(q) === "testTagList:labelsFor" ? LABELS : undefined) };
});

import { PrintTagsDialog } from "../print-tags-dialog";
import { ReportsDialog } from "../reports-dialog";
import { ScheduleTestDialog } from "../schedule-test-dialog";

beforeEach(() => {
  writes.create.mockClear();
  writes.undoCreate.mockClear();
  announced.last = undefined;
  toast.error.mockClear();
});

describe("ReportsDialog", () => {
  it("lists the ten reports; a report with a required pick asks for it, a plain one opens its PDF route", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ReportsDialog open onOpenChange={() => {}} orgId="org1" />);
    expect(screen.getAllByRole("button").filter((b) => /PDF|CSV/.test(b.textContent ?? "")).length).toBe(10);
    await user.click(screen.getByRole("button", { name: /Item history/ }));
    await user.click(screen.getByRole("button", { name: /Generate PDF/ }));
    expect(toast.error).toHaveBeenCalledWith("Please select a test tag item");
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /All reports/ }));
    await user.click(screen.getByRole("button", { name: /Compliance certificate/ }));
    await user.click(screen.getByRole("button", { name: /Generate PDF/ }));
    expect(open).toHaveBeenCalledWith("/api/test-tag-reports/compliance-certificate?format=pdf", "_blank");
    open.mockRestore();
  });

  it("a date-range report sends the dates it was given", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ReportsDialog open onOpenChange={() => {}} orgId="org1" />);
    await user.click(screen.getByRole("button", { name: /Test session report/ }));
    await user.type(screen.getByLabelText("From"), "2026-01-01");
    await user.click(screen.getByRole("button", { name: /Generate PDF/ }));
    expect(open).toHaveBeenCalledWith("/api/test-tag-reports/session?format=pdf&dateFrom=2026-01-01", "_blank");
    open.mockRestore();
  });
});

describe("PrintTagsDialog", () => {
  it("prints a label per tested item in sheet mode and NAMES the never-tested one", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintTagsDialog ids={["t1", "t2"]} orgId="org1" onClose={() => {}} />);
    expect(screen.getByText(/1 label ready to print/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("TT-0002");
    const sheet = screen.getByTestId("tag-sheet");
    expect(sheet.querySelectorAll(".test-tag-label").length).toBe(1);
    expect(sheet.textContent).toContain("TT-0001");
    expect(document.querySelector("style")?.textContent).toContain(".test-tag-sheet");
    await user.click(screen.getByRole("button", { name: /^Print$/ }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it("renders nothing while closed", () => {
    render(<PrintTagsDialog ids={null} orgId="org1" onClose={() => {}} />);
    expect(screen.queryByTestId("tag-sheet")).toBeNull();
    expect(screen.queryByText("Print tags")).toBeNull();
  });
});

describe("ScheduleTestDialog", () => {
  const items = [
    { id: "t1", testTagId: "TT-0001", assetId: "a1" },
    { id: "t2", testTagId: "TT-0002", assetId: null },
  ];

  it("books ONE scheduled TEST_AND_TAG job for the linked assets, names the skipped item, and the toast Undo is the exact reverse", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ScheduleTestDialog items={items} onClose={onClose} />);
    expect(screen.getByRole("status").textContent).toContain("TT-0002");
    const submit = screen.getByRole("button", { name: "Schedule" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // a date is required
    await user.type(screen.getByLabelText("Date"), "2026-03-02");
    await user.click(submit);
    expect(writes.create).toHaveBeenCalledTimes(1);
    expect(writes.create).toHaveBeenCalledWith(expect.objectContaining({ type: "TEST_AND_TAG", status: "SCHEDULED", assetIds: ["a1"], title: "Test & tag: 2 items", scheduledDate: new Date(2026, 2, 2) }));
    expect(announced.last?.title).toBe("Scheduled testing for 1 asset · skipped TT-0002: no linked asset");
    announced.last?.undo?.();
    expect(writes.undoCreate).toHaveBeenCalledWith("job1");
    expect(onClose).toHaveBeenCalled();
  });

  it("with no linked asset there is nothing to book: the button stays disabled and nothing is written", async () => {
    const user = userEvent.setup();
    render(<ScheduleTestDialog items={[items[1]]} onClose={() => {}} />);
    await user.type(screen.getByLabelText("Date"), "2026-03-02");
    expect((screen.getByRole("button", { name: "Schedule" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Nothing to schedule");
    expect(writes.create).not.toHaveBeenCalled();
  });
});
