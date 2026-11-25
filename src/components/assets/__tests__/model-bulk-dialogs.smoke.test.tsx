// @vitest-environment jsdom
//
// The Models list's bulk dialogs OPEN, write once, and their toast Undo is the ONE closure that calls the
// exact server Undo (ids only): Edit rates restores each model's rate; Assign checks removes exactly the
// assignments it created.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
const mw = vi.hoisted(() => ({
  bulkUpdateRates: vi.fn(async (ids: string[]) => ({ count: ids.length, auditIds: ids.map((i) => `a-${i}`) })),
  undoModelFieldEdits: vi.fn(async () => ({ restored: 2 })),
}));
vi.mock("@/hooks/use-model-writes", () => ({ useModelWrites: () => mw }));
const cw = vi.hoisted(() => ({
  bulkAddCheckItemsToModels: vi.fn(async () => ({ count: 3, modelNames: ["A", "B"], auditId: "as1" })),
  undoAssignChecks: vi.fn(async () => ({ removed: 3, left: 0 })),
}));
vi.mock("@/hooks/use-check-item-writes", () => ({ useCheckItemWrites: () => cw }));
vi.mock("@/hooks/use-check-items", () => ({ useCheckItems: () => [{ id: "c1", label: "Visual", type: "PASS_FAIL", category: "General" }] }));
const toasts = vi.hoisted(() => ({ last: undefined as undefined | { title: string; opts?: { action?: { onClick: () => void } } } }));
vi.mock("sonner", () => ({
  toast: { success: (title: string, opts?: { action?: { onClick: () => void } }) => void (toasts.last = { title, opts }), error: vi.fn() },
}));

import { BulkAssignChecksDialog, BulkRateUpdateDialog } from "../model-bulk-dialogs";

beforeEach(() => {
  mw.bulkUpdateRates.mockClear();
  mw.undoModelFieldEdits.mockClear();
  cw.bulkAddCheckItemsToModels.mockClear();
  cw.undoAssignChecks.mockClear();
  toasts.last = undefined;
});

describe("model bulk dialogs (smoke)", () => {
  it("Edit rates: writes once, and the toast's Undo restores through the exact server Undo, once", async () => {
    const user = userEvent.setup();
    render(<BulkRateUpdateDialog open onOpenChange={() => {}} selectedModelIds={new Set(["m1", "m2"])} onSuccess={() => {}} />);
    expect(await screen.findByText("Edit rates — 2 models")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("e.g. 100.00"), "120");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await vi.waitFor(() => expect(mw.bulkUpdateRates).toHaveBeenCalledWith(["m1", "m2"], "dailyRate", "set", 120));
    await vi.waitFor(() => expect(toasts.last?.title).toBe("Updated Daily rate on 2 models"));
    toasts.last?.opts?.action?.onClick();
    toasts.last?.opts?.action?.onClick();
    await vi.waitFor(() => expect(mw.undoModelFieldEdits).toHaveBeenCalledTimes(1));
    expect(mw.undoModelFieldEdits).toHaveBeenCalledWith(["a-m1", "a-m2"]);
  });

  it("Assign checks: pick a check, assign, Undo removes exactly what that call created", async () => {
    const user = userEvent.setup();
    render(<BulkAssignChecksDialog open onOpenChange={() => {}} selectedModelIds={new Set(["m1", "m2"])} onSuccess={() => {}} />);
    await user.click(await screen.findByText("Visual"));
    await user.click(screen.getByRole("button", { name: "Assign 1 check" }));
    await vi.waitFor(() => expect(cw.bulkAddCheckItemsToModels).toHaveBeenCalledWith(["m1", "m2"], ["c1"]));
    await vi.waitFor(() => expect(toasts.last?.title).toBe("Assigned checks to 2 models (3 new)"));
    toasts.last?.opts?.action?.onClick();
    await vi.waitFor(() => expect(cw.undoAssignChecks).toHaveBeenCalledWith("as1"));
  });
});
