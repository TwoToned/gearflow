// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const deleteRecalled = vi.fn().mockResolvedValue({ id: "q1", deletedVersion: 2, revision: 1 });

vi.mock("@/hooks/use-quote-writes", () => ({
  useQuoteWrites: vi.fn(() => ({ deleteRecalled })),
}));

import { DeleteRecalledDialog } from "@/components/projects/finance/delete-recalled-dialog";

/**
 * Basic render + typed-confirmation coverage (#1029) — the one dialog in the
 * app that permanently erases a document a client may already hold, so the
 * "type the label exactly" gate is the whole point of the test, not an
 * afterthought.
 */
describe("DeleteRecalledDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    quoteId: "q1",
    label: "RVLT-2026-0087 v2",
  };

  it("renders without throwing and keeps the delete button disabled until the label matches exactly", async () => {
    const user = userEvent.setup();
    render(<DeleteRecalledDialog {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Permanently delete RVLT-2026-0087 v2/ })).toBeTruthy(),
    );

    const confirmButton = screen.getByRole("button", { name: /delete permanently/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    const input = screen.getByLabelText(/type/i);
    await user.type(input, "RVLT-2026-0087 V2"); // wrong case
    expect(confirmButton.disabled).toBe(true);

    await user.clear(input);
    await user.type(input, "RVLT-2026-0087 v2");
    expect(confirmButton.disabled).toBe(false);
  });

  it("submits only once the label matches", async () => {
    const user = userEvent.setup();
    render(<DeleteRecalledDialog {...baseProps} />);

    const input = await screen.findByLabelText(/type/i);
    await user.type(input, "RVLT-2026-0087 v2");
    await user.click(screen.getByRole("button", { name: /delete permanently/i }));

    await waitFor(() => expect(deleteRecalled).toHaveBeenCalledWith("q1", { confirmLabel: "RVLT-2026-0087 v2" }));
  });
});
