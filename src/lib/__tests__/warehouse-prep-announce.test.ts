import { describe, it, expect, vi, beforeEach } from "vitest";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/lib/show-error", () => ({ showError: vi.fn() }));

import { announcePrepWrite } from "../warehouse-prep-announce";

describe("announcePrepWrite", () => {
  beforeEach(() => toastSuccess.mockClear());

  it("the strip's scanUndo runs the toast's own closure, once", async () => {
    const deprep = vi.fn().mockResolvedValue(undefined);
    const res = announcePrepWrite({ doneTitle: "Prepped Lamp", undoneTitle: "Undone", reverse: [{ lineItemId: "l1" }], canUndo: true, deprep });
    const toastAction = toastSuccess.mock.calls[0][1].action;
    expect(toastAction.onClick).toBe(res.scanUndo);
    await res.scanUndo!();
    await toastAction.onClick();
    expect(deprep).toHaveBeenCalledTimes(1);
    expect(deprep).toHaveBeenCalledWith([{ lineItemId: "l1" }]);
  });

  it("offers no Undo without the reverse permission or a reverse op", () => {
    const deprep = vi.fn();
    expect(announcePrepWrite({ doneTitle: "x", undoneTitle: "y", reverse: [{ lineItemId: "l" }], canUndo: false, deprep }).scanUndo).toBeUndefined();
    expect(announcePrepWrite({ doneTitle: "x", undoneTitle: "y", reverse: [], canUndo: true, deprep }).scanUndo).toBeUndefined();
  });
});
