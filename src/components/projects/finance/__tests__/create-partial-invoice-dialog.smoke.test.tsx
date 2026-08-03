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

import { CreatePartialInvoiceDialog } from "@/components/projects/finance/create-partial-invoice-dialog";

/**
 * Basic render + mode-toggle coverage (#1055, generalised when the rigid
 * deposit-then-balance sequencing was dropped) — the two ways an operator can
 * size a partial (kind DEPOSIT) invoice. Defaults to percentage mode;
 * switching to "Fixed amount" swaps the input and re-derives the preview
 * total. Bounded by `remainingAmount`, not the full project total, since a
 * project can carry several partials before the remainder is raised.
 */
describe("CreatePartialInvoiceDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: "p1",
    clientId: "c1",
    defaultDepositPercent: 25,
    projectTotal: 1100,
    remainingAmount: 1100,
  };

  it("renders in percentage mode by default and creates a %-mode partial invoice", async () => {
    const user = userEvent.setup();
    render(<CreatePartialInvoiceDialog {...baseProps} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /create partial invoice/i })).toBeTruthy());

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

  it("switches to fixed-amount mode and creates a $-mode partial invoice", async () => {
    const user = userEvent.setup();
    render(<CreatePartialInvoiceDialog {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /fixed amount/i }));
    const amountInput = await screen.findByLabelText(/invoice amount/i);
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

  it("disables the create button when the amount exceeds what's remaining", async () => {
    const user = userEvent.setup();
    render(<CreatePartialInvoiceDialog {...baseProps} remainingAmount={400} />);

    await user.click(screen.getByRole("button", { name: /fixed amount/i }));
    const amountInput = await screen.findByLabelText(/invoice amount/i);
    await user.type(amountInput, "500");

    expect((screen.getByRole("button", { name: /create draft/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/exceeds the \$400\.00 remaining balance/i);
  });
});
