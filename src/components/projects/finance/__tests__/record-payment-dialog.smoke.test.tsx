// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const record = vi.fn().mockResolvedValue({ id: "pay1" });

vi.mock("@/hooks/use-payment-writes", () => ({
  usePaymentWrites: vi.fn(() => ({ record })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RecordPaymentDialog } from "@/components/projects/finance/record-payment-dialog";

/**
 * Basic render coverage (#1055) — renders inside a Radix modal `Dialog` (see
 * CLAUDE.md's Radix/Base-UI-in-modal regression class), amount prefills from
 * the current balance remaining, and the method Select defaults to bank
 * transfer without needing to open the popover (jsdom doesn't implement the
 * pointer-capture APIs Radix Select's open state relies on).
 */
describe("RecordPaymentDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    invoiceId: "i1",
    invoiceNumber: "INV-2026-0042",
    balanceRemaining: 825,
  };

  it("renders without throwing, prefilling amount from the balance remaining", async () => {
    render(<RecordPaymentDialog {...baseProps} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /record payment/i })).toBeTruthy());

    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(amountInput.value).toBe("825.00");
    expect(screen.getByText(/bank transfer/i)).toBeTruthy();
  });

  it("submits the recorded payment with the entered fields", async () => {
    const user = userEvent.setup();
    render(<RecordPaymentDialog {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /record payment/i }));

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const [invoiceId, data] = record.mock.calls[0] as [string, Record<string, unknown>];
    expect(invoiceId).toBe("i1");
    expect(data.amount).toBe("825.00");
    expect(data.method).toBe("BANK_TRANSFER");
  });
});
