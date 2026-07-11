// @vitest-environment jsdom
/**
 * Smoke test for BulkEditLineItemsDialog — renders the overlay (catching the
 * class of render-time crashes CLAUDE.md warns about) and proves the per-field
 * enable-toggle gating: Apply is disabled until a field is enabled, and only
 * enabled fields reach onSubmit.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BulkEditLineItemsDialog } from "./bulk-edit-line-items-dialog";

describe("BulkEditLineItemsDialog", () => {
  it("renders and reflects the selection count", () => {
    render(
      <BulkEditLineItemsDialog
        open
        onOpenChange={() => {}}
        count={3}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("Bulk edit 3 items")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Apply to 3 items/ }),
    ).toBeDisabled();
  });

  it("keeps Apply disabled until a field is enabled, then submits only that field", () => {
    const onSubmit = vi.fn();
    render(
      <BulkEditLineItemsDialog
        open
        onOpenChange={() => {}}
        count={2}
        onSubmit={onSubmit}
      />,
    );

    const apply = screen.getByRole("button", { name: /Apply to 2 items/ });
    expect(apply).toBeDisabled();

    // Enable the first field (pricing type). The enable checkboxes are the
    // leading checkbox of each field row.
    const pricingEnable = screen.getAllByRole("checkbox")[0];
    fireEvent.click(pricingEnable);
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Only the enabled field is present; discount/notes/optional are omitted.
    const patch = onSubmit.mock.calls[0][0];
    expect(patch).toEqual({ pricingType: "PER_DAY" });
  });
});
