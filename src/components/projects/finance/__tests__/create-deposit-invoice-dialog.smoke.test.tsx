// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const create = vi.fn().mockResolvedValue({ id: "i1" });

vi.mock("@/hooks/use-invoice-writes", () => ({
  useInvoiceWrites: vi.fn(() => ({ create })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreateDepositInvoiceDialog } from "@/components/projects/finance/create-deposit-invoice-dialog";

/**
 * Basic render + mode-toggle coverage (#1055) — the two ways an operator can
 * size a DEPOSIT invoice. Defaults to percentage mode; switching to "Fixed
 * amount" swaps the input and re-derives the preview total.
 */
describe("CreateDepositInvoiceDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: "p1",
    clientId: "c1",
    defaultDepositPercent: 25,
    projectTotal: 1100,
  };

  it("renders in percentage mode by default and creates a %-mode deposit", async () => {
    const user = userEvent.setup();
    render(<CreateDepositInvoiceDialog {...baseProps} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /create deposit invoice/i })).toBeTruthy());

    expect(screen.getByLabelText(/% of project total/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /create draft/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("p1", "c1", {
        kind: "DEPOSIT",
        depositMode: "%",
        depositPercent: 25,
        depositAmount: undefined,
      }),
    );
  });

  it("switches to fixed-amount mode and creates a $-mode deposit", async () => {
    const user = userEvent.setup();
    render(<CreateDepositInvoiceDialog {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /fixed amount/i }));
    const amountInput = await screen.findByLabelText(/deposit amount/i);
    await user.type(amountInput, "500");

    await user.click(screen.getByRole("button", { name: /create draft/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("p1", "c1", {
        kind: "DEPOSIT",
        depositMode: "$",
        depositPercent: undefined,
        depositAmount: 500,
      }),
    );
  });
});
