// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const deleteVoid = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/use-invoice-writes", () => ({
  useInvoiceWrites: vi.fn(() => ({ deleteVoid })),
}));

import { DeleteVoidInvoiceDialog } from "@/components/projects/finance/delete-void-invoice-dialog";

/**
 * Basic render + typed-confirmation coverage (#1055) — the invoice-side
 * counterpart to DeleteRecalledDialog's own smoke test. The "type the label
 * exactly" gate is the whole point, not an afterthought.
 */
describe("DeleteVoidInvoiceDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    invoiceId: "i1",
    label: "INV-2026-0042",
  };

  it("renders without throwing and keeps the delete button disabled until the label matches exactly", async () => {
    const user = userEvent.setup();
    render(<DeleteVoidInvoiceDialog {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Permanently delete INV-2026-0042/ })).toBeTruthy(),
    );

    const confirmButton = screen.getByRole("button", { name: /delete permanently/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    const input = screen.getByLabelText(/type/i);
    await user.type(input, "inv-2026-0042"); // wrong case
    expect(confirmButton.disabled).toBe(true);

    await user.clear(input);
    await user.type(input, "INV-2026-0042");
    expect(confirmButton.disabled).toBe(false);
  });

  it("submits only once the label matches", async () => {
    const user = userEvent.setup();
    render(<DeleteVoidInvoiceDialog {...baseProps} />);

    const input = await screen.findByLabelText(/type/i);
    await user.type(input, "INV-2026-0042");
    await user.click(screen.getByRole("button", { name: /delete permanently/i }));

    await waitFor(() => expect(deleteVoid).toHaveBeenCalledWith("i1", { confirmLabel: "INV-2026-0042" }));
  });
});
