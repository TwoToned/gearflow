// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const toastSuccessMock = vi.fn();
const showErrorMock = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccessMock(...args) } }));
vi.mock("@/lib/show-error", () => ({ showError: (...args: unknown[]) => showErrorMock(...args) }));

import { announceWarehouseWrite, countLabel } from "@/lib/warehouse-undo-toast";

describe("countLabel", () => {
  it("pluralises only when the count isn't exactly 1", () => {
    expect(countLabel(1, "item")).toBe("1 item");
    expect(countLabel(2, "item")).toBe("2 items");
    expect(countLabel(0, "kit")).toBe("0 kits");
  });
});

describe("announceWarehouseWrite", () => {
  beforeEach(() => {
    toastSuccessMock.mockClear();
    showErrorMock.mockClear();
  });

  it("shows the plain doneTitle with an Undo action when canUndo and no autoStatus", () => {
    const performUndo = vi.fn().mockResolvedValue(undefined);
    announceWarehouseWrite(
      { autoStatus: null },
      { doneTitle: "Deployed 3 items", undoneTitle: "Undone", canUndo: true, performUndo },
    );

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [title, opts] = toastSuccessMock.mock.calls[0];
    expect(title).toBe("Deployed 3 items");
    expect(opts.duration).toBe(10_000);
    expect(opts.action.label).toBe("Undo");
  });

  it("omits the action entirely when canUndo is false", () => {
    announceWarehouseWrite(
      { autoStatus: null },
      { doneTitle: "Deployed 3 items", undoneTitle: "Undone", canUndo: false, performUndo: vi.fn() },
    );
    const [, opts] = toastSuccessMock.mock.calls[0];
    expect(opts.action).toBeUndefined();
  });

  it("folds a status move into the title instead of firing a second toast", () => {
    announceWarehouseWrite(
      { autoStatus: "CHECKED_OUT" },
      { doneTitle: "Deployed 12 items", undoneTitle: "Undone", canUndo: true, performUndo: vi.fn() },
    );
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [title] = toastSuccessMock.mock.calls[0];
    expect(title).toBe("Deployed 12 items · job moved to Deployed");
  });

  it("an unmapped/null autoStatus never appends a fragment", () => {
    announceWarehouseWrite(
      { autoStatus: null },
      { doneTitle: "Deployed 1 item", undoneTitle: "Undone", canUndo: true, performUndo: vi.fn() },
    );
    const [title] = toastSuccessMock.mock.calls[0];
    expect(title).toBe("Deployed 1 item");
  });

  it("Undo click calls performUndo once and shows the undone toast", async () => {
    const performUndo = vi.fn().mockResolvedValue(undefined);
    announceWarehouseWrite(
      { autoStatus: null },
      { doneTitle: "Deployed 1 item", undoneTitle: "Undone — 1 item back in Prepped", canUndo: true, performUndo },
    );
    const [, opts] = toastSuccessMock.mock.calls[0];

    await opts.action.onClick();
    expect(performUndo).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenLastCalledWith("Undone — 1 item back in Prepped");
  });

  it("double-tap: a second click is a no-op, not a second reverse", async () => {
    const performUndo = vi.fn().mockResolvedValue(undefined);
    announceWarehouseWrite(
      { autoStatus: null },
      { doneTitle: "Deployed 1 item", undoneTitle: "Undone", canUndo: true, performUndo },
    );
    const [, opts] = toastSuccessMock.mock.calls[0];

    await Promise.all([opts.action.onClick(), opts.action.onClick()]);
    expect(performUndo).toHaveBeenCalledTimes(1);
  });

  it("a failing undo surfaces showError with the 'Couldn't undo' fallback, not a thrown error", async () => {
    const performUndo = vi.fn().mockRejectedValue(new Error("race: gear already moved"));
    announceWarehouseWrite(
      { autoStatus: null },
      { doneTitle: "Deployed 1 item", undoneTitle: "Undone", canUndo: true, performUndo },
    );
    const [, opts] = toastSuccessMock.mock.calls[0];

    await expect(opts.action.onClick()).resolves.toBeUndefined();
    expect(showErrorMock).toHaveBeenCalledWith(expect.any(Error), { fallbackTitle: "Couldn't undo" });
  });
});
