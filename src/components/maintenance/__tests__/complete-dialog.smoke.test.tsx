// @vitest-environment jsdom
//
// The Complete dialog (14b-3): each asset's disposition DEFAULTS from the result (Fail keeps it out) and only what the
// person changed is sent; Retire warns there is no Undo; labour blank is not $0 (clears a stored one, leaves an absent
// one) and is not offered to a caller who cannot see job cost; a bad value does not submit.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/show-error", () => ({ showError: vi.fn() }));

import { CompleteDialog, defaultDisposition } from "../record/complete-dialog";

const NOW = Date.UTC(2026, 10, 25, 9);
const ASSETS = [
  { assetId: "a1", assetTag: "DSK-1", modelName: "Mixing desk" },
  { assetId: "a2", assetTag: "DSK-2", modelName: "Mixing desk" },
];
const onComplete = vi.fn(async (_i: unknown) => {});

const show = (over: Partial<React.ComponentProps<typeof CompleteDialog>> = {}) =>
  render(<CompleteDialog open onOpenChange={() => {}} title="Fix the desk" now={NOW} assets={ASSETS} labourVisible storedLabour={50} storedNextDue={null} onComplete={onComplete} {...over} />);
const sent = () => onComplete.mock.calls[0][0] as Record<string, unknown>;

beforeEach(() => onComplete.mockClear());

describe("defaultDisposition", () => {
  it("a Fail keeps assets out of service, anything else returns them", () => {
    expect(defaultDisposition("FAIL")).toBe("KEEP_OUT_OF_SERVICE");
    expect(defaultDisposition("PASS")).toBe("RETURN_TO_SERVICE");
    expect(defaultDisposition("CONDITIONAL")).toBe("RETURN_TO_SERVICE");
  });
});

describe("CompleteDialog", () => {
  it("opens with today, a Pass, the stored labour and every asset on its default; an untouched submit sends no dispositions", async () => {
    const user = userEvent.setup();
    show();
    expect((screen.getByLabelText("Completed") as HTMLInputElement).value).toBe("2026-11-25");
    expect((screen.getByLabelText("Labour ($)") as HTMLInputElement).value).toBe("50");
    for (const tag of ["DSK-1", "DSK-2"]) expect(screen.getByRole("combobox", { name: `${tag} disposition` }).textContent).toBe("Return to service");
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(sent()).toMatchObject({ result: "PASS", completedDate: Date.UTC(2026, 10, 25), labour: 50 });
    expect(sent()).not.toHaveProperty("dispositions");
  });

  it("choosing Fail moves every untouched asset to Keep out of service (still no overrides sent)", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("combobox", { name: "Result" }));
    await user.click(await screen.findByRole("option", { name: "Fail" }));
    for (const tag of ["DSK-1", "DSK-2"]) expect(screen.getByRole("combobox", { name: `${tag} disposition` }).textContent).toBe("Keep out of service");
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(sent().result).toBe("FAIL");
    expect(sent()).not.toHaveProperty("dispositions");
  });

  it("only the asset the person changed is sent; Retire says it cannot be undone", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("combobox", { name: "DSK-2 disposition" }));
    await user.click(await screen.findByRole("option", { name: "Retire" }));
    expect(screen.getByRole("note").textContent).toMatch(/no Undo/);
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(sent().dispositions).toEqual([{ assetId: "a2", disposition: "RETIRE" }]);
  });

  it("blank labour clears a stored one, but leaves an absent one alone; a typed 0 is a real 0", async () => {
    const user = userEvent.setup();
    const a = show();
    await user.clear(screen.getByLabelText("Labour ($)"));
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(sent().labour).toBeNull();
    a.unmount();

    onComplete.mockClear();
    const b = show({ storedLabour: null });
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(sent().labour).toBeUndefined();
    b.unmount();

    onComplete.mockClear();
    show({ storedLabour: null });
    await user.type(screen.getByLabelText("Labour ($)"), "0");
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(sent().labour).toBe(0);
  });

  it("a caller who cannot see job cost is not offered labour and sends none", async () => {
    const user = userEvent.setup();
    show({ labourVisible: false, storedLabour: null });
    expect(screen.queryByLabelText("Labour ($)")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(sent()).not.toHaveProperty("labour");
  });

  it("next due: a stored one is cleared by a blank box; none stored stays absent", async () => {
    const user = userEvent.setup();
    show({ storedNextDue: Date.UTC(2027, 0, 5) });
    expect((screen.getByLabelText("Next due") as HTMLInputElement).value).toBe("2027-01-05");
    await user.clear(screen.getByLabelText("Next due"));
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(sent().nextDueDate).toBeNull();
  });

  it("negative labour and a missing date do not submit", async () => {
    const user = userEvent.setup();
    show();
    await user.clear(screen.getByLabelText("Labour ($)"));
    await user.type(screen.getByLabelText("Labour ($)"), "-5");
    await user.click(screen.getByRole("button", { name: "Complete" }));
    expect(onComplete).not.toHaveBeenCalled(); // the box's own min=0 validation stops it
    await user.clear(screen.getByLabelText("Labour ($)"));
    await user.clear(screen.getByLabelText("Completed"));
    await user.click(screen.getByRole("button", { name: "Complete" }));
    expect(within(document.body).getByRole("alert").textContent).toMatch(/date it was completed/);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
