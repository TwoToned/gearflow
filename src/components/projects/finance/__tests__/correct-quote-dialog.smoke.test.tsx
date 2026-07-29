// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const correct = vi.fn().mockResolvedValue({ id: "q1", version: 2, quoteDate: 0, validUntil: 0 });

vi.mock("@/hooks/use-quote-writes", () => ({
  useQuoteWrites: vi.fn(() => ({ correct })),
}));

import { CorrectQuoteDialog } from "@/components/projects/finance/correct-quote-dialog";

/**
 * Basic render + submit coverage (#1031) — the standing jsdom-smoke rule
 * (CLAUDE.md) applies to any new overlay UI, not only the Base-UI-in-modal
 * footgun class: typecheck/lint/build all pass on a dialog that throws at
 * render time, only actually mounting it catches that.
 */
describe("CorrectQuoteDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    quoteId: "q1",
    version: 2,
    currentQuoteDate: Date.UTC(2026, 0, 15),
    currentValidityDays: 30,
  };

  it("renders without throwing and pre-fills the current date", async () => {
    render(<CorrectQuoteDialog {...baseProps} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Correct v2/ })).toBeTruthy());
    expect(screen.getByText(/not a re-price/i)).toBeTruthy();
    const dateInput = screen.getByLabelText(/Corrected date/i) as HTMLInputElement;
    expect(dateInput.value).toBe("2026-01-15");
  });

  it("submits the corrected date", async () => {
    const user = userEvent.setup();
    render(<CorrectQuoteDialog {...baseProps} />);

    const dateInput = await screen.findByLabelText(/Corrected date/i);
    await user.clear(dateInput);
    await user.type(dateInput, "2026-02-01");
    await user.click(screen.getByRole("button", { name: /save correction/i }));

    await waitFor(() =>
      expect(correct).toHaveBeenCalledWith("q1", { quoteDate: new Date("2026-02-01"), validityDays: 30 }),
    );
  });
});
